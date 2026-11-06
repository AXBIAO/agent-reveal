import { loadSettings, saveSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const speedLabel = (v) => `${Number(v).toFixed(1)}×`;
const VIEW_HINTS = {
  desktop: '按当前窗口大小播放和录屏',
  mobile: '窗口会临时缩成手机尺寸（390×844），录出竖屏视频，结束后恢复',
};

const currentView = () => (document.querySelector('input[name="view"]:checked') || {}).value || 'desktop';

function readForm() {
  return {
    record: $('record').checked,
    maxAgents: $('maxAgents').value,
    speed: $('speed').value,
    showNames: $('showNames').checked,
    view: currentView(),
    sound: $('sound').checked,
    rulers: $('rulers').checked,
    autoScroll: $('autoScroll').checked,
  };
}

function showViewHint() {
  $('viewHint').textContent = VIEW_HINTS[currentView()];
}

function fillForm(s) {
  $('record').checked = s.record;
  $('maxAgents').value = s.maxAgents;
  $('speed').value = s.speed;
  $('showNames').checked = s.showNames;
  $('sound').checked = s.sound;
  $('rulers').checked = s.rulers;
  $('autoScroll').checked = s.autoScroll;
  $(s.view === 'mobile' ? 'viewMobile' : 'viewDesktop').checked = true;
  $('maxAgentsOut').textContent = s.maxAgents;
  $('speedOut').textContent = speedLabel(s.speed);
  showViewHint();
}

// 测试时可用 ?tabId= 指定目标标签页
async function targetTabId() {
  const fromQuery = Number(new URLSearchParams(location.search).get('tabId'));
  if (fromQuery) return fromQuery;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id;
}

async function start() {
  $('start').disabled = true;
  $('status').textContent = '';
  try {
    const settings = await saveSettings(readForm());
    const tabId = await targetTabId();
    if (!tabId) throw new Error('找不到当前标签页');
    const res = await chrome.runtime.sendMessage({ type: 'start', tabId, settings });
    if (!res || !res.ok) throw new Error((res && res.error) || '启动失败');
    window.close();
  } catch (err) {
    $('status').textContent = err.message;
    $('start').disabled = false;
  }
}

$('maxAgents').addEventListener('input', (e) => { $('maxAgentsOut').textContent = e.target.value; });
$('speed').addEventListener('input', (e) => { $('speedOut').textContent = speedLabel(e.target.value); });
document.querySelectorAll('input[name="view"]').forEach((r) => r.addEventListener('change', showViewHint));
$('start').addEventListener('click', start);
loadSettings().then(fillForm);
