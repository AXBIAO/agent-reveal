// 后台 Service Worker：注入动画、协调离屏录屏、保存视频并回报真实路径
import { loadSettings, sanitize } from './settings.js';
import { injectConfig, pageToast, showSavedPanel } from './page-ui.js';
import { recordingFileName } from './naming.js';

// 会话状态放 storage.session：动画期间 SW 可能被回收，内存变量会丢
const sessionKey = (tabId) => `session:${tabId}`;

async function getSession(tabId) {
  const k = sessionKey(tabId);
  return (await chrome.storage.session.get(k))[k] || null;
}
const setSession = (tabId, v) => chrome.storage.session.set({ [sessionKey(tabId)]: v });
const clearSession = (tabId) => chrome.storage.session.remove(sessionKey(tabId));

const toOffscreen = (type, extra = {}) => chrome.runtime.sendMessage({ target: 'offscreen', type, ...extra });
const runInTab = (tabId, func, ...args) => chrome.scripting.executeScript({ target: { tabId }, func, args });

async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: '录制当前标签页的演示动画',
  });
}

async function startRecordingTab(tabId) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const r = await toOffscreen('rec-start', { streamId });
  if (!r || !r.ok) throw new Error((r && r.error) || '录屏启动失败');
}

async function startOnTab(tabId, rawSettings) {
  const settings = sanitize(rawSettings);
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:|^file:/.test(tab.url || '')) throw new Error('这个页面不能运行（浏览器内置页面受限制）');
  if (await getSession(tabId)) throw new Error('这个标签页已经在播放了');

  let recording = false;
  if (settings.record) {
    try {
      await startRecordingTab(tabId);
      recording = true;
    } catch (err) {
      console.warn('[agent-reveal] 录屏未启动', err);
      await runInTab(tabId, pageToast, `录屏未启动：${err.message}，本次只播放`);
    }
  }
  await setSession(tabId, { recording, host: new URL(tab.url).hostname || 'page' });
  const { record, ...cfg } = settings;
  await runInTab(tabId, injectConfig, cfg);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['agent-reveal.js'] });
  return {};
}


function waitForDownload(id) {
  return new Promise((resolve, reject) => {
    const onChanged = (delta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(onChanged);
        chrome.downloads.search({ id }).then(([item]) => (
          item && item.state === 'complete' ? resolve(item) : reject(new Error((item && item.error) || '下载中断'))
        ));
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

async function saveRecording(tabId, host, rec) {
  try {
    const id = await chrome.downloads.download({ url: rec.url, filename: recordingFileName(host, rec.mime), conflictAction: 'uniquify', saveAs: false });
    const item = await waitForDownload(id);
    await runInTab(tabId, showSavedPanel, { path: item.filename, size: item.fileSize || rec.size, id });
  } catch (err) {
    console.error('[agent-reveal] 保存失败', err);
    await runInTab(tabId, pageToast, `录屏保存失败：${err.message}`).catch(() => {});
  } finally {
    toOffscreen('revoke', { url: rec.url }).catch(() => {});
  }
}

// 动画跑完（页面还原前）：先停录保住 Done 画面，立即回复让页面继续，再异步保存
async function onRevealDone(tabId) {
  const s = await getSession(tabId);
  await clearSession(tabId);
  if (!s || !s.recording) return {};
  const rec = await toOffscreen('rec-stop');
  if (!rec || !rec.ok) throw new Error((rec && rec.error) || '停止录屏失败');
  saveRecording(tabId, s.host, rec);
  return {};
}

async function onRevealAbort(tabId) {
  const s = await getSession(tabId);
  await clearSession(tabId);
  if (s && s.recording) await toOffscreen('rec-discard');
  return {};
}

const HANDLERS = {
  start: (m) => startOnTab(m.tabId, m.settings),
  'reveal-done': (_m, sender) => onRevealDone(sender.tab.id),
  'reveal-abort': (_m, sender) => onRevealAbort(sender.tab.id),
  'show-file': (m) => { chrome.downloads.show(m.id); return {}; },
  'open-file': async (m) => {
    try { await chrome.downloads.open(m.id); } catch { chrome.downloads.show(m.id); }
    return {};
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen' || !HANDLERS[msg.type]) return false;
  Promise.resolve()
    .then(() => HANDLERS[msg.type](msg, sender))
    .then((r) => sendResponse({ ok: true, ...r }), (err) => sendResponse({ ok: false, error: err.message }));
  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'start-reveal' || !tab) return;
  try {
    await startOnTab(tab.id, await loadSettings());
  } catch (err) {
    await runInTab(tab.id, pageToast, err.message).catch(() => {});
  }
});

// 标签页关闭时清理会话，防止残留状态挡住下次启动
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (await getSession(tabId)) await onRevealAbort(tabId);
});
// 播放途中刷新/跳转：页面脚本已不在，丢弃录屏
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === 'loading' && await getSession(tabId)) await onRevealAbort(tabId);
});

// 测试入口：Playwright 无法点工具栏按钮，通过 SW 上下文直接调用
globalThis.__agentRevealTest = { startOnTab };
