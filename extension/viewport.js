// 手机视图：临时把当前窗口缩成手机比例，并提高该标签页缩放，使 CSS 视口为 390×844。
// 不新开窗口、不刷新页面（刷新会让 activeTab 授权失效），也不用 debugger 权限（会出现调试提示条）。

export const MOBILE = Object.freeze({ width: 390, height: 844 });
const MAX_ZOOM = 3;
const SETTLE_MS = 450;
const MAX_OVERFLOW = 1.9; // 窗口高度最多为可用屏幕高度的 1.9 倍（Chrome 要求至少 50% 在屏幕内）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 注入页面执行：读取视口与可用屏幕（CSS 像素）
function measure() {
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    availW: screen.availWidth,
    availH: screen.availHeight,
    availLeft: screen.availLeft || 0,
    availTop: screen.availTop || 0,
  };
}

async function measureTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: measure });
  return result;
}

// 纯计算：给定窗口边框大小与可用屏幕（DIP），算出缩放和窗口尺寸
export function planMobileWindow({ frameW, frameH, availW, availH, availLeft, availTop }) {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, (availH - frameH) / MOBILE.height));
  const width = Math.round(MOBILE.width * zoom + frameW);
  const height = Math.round(MOBILE.height * zoom + frameH);
  return {
    zoom: Math.round(zoom * 100) / 100,
    width,
    height,
    left: Math.round(availLeft + Math.max(0, (availW - width) / 2)),
    top: Math.round(availTop),
  };
}

// 返回恢复所需的信息；调用方负责在结束/中止时调用 restoreView
export async function enterMobileView(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  const prevZoom = await chrome.tabs.getZoom(tabId);
  const prevZoomSettings = await chrome.tabs.getZoomSettings(tabId);
  const restore = {
    tabId,
    windowId: win.id,
    state: win.state,
    bounds: { left: win.left, top: win.top, width: win.width, height: win.height },
    zoomSettings: { mode: prevZoomSettings.mode, scope: prevZoomSettings.scope },
  };

  try {
    return await applyMobile(tabId, win, prevZoom, restore);
  } catch (err) {
    // 中途失败也要把窗口和缩放恢复
    await restoreView({ restore, prevZoom });
    throw err;
  }
}

async function setWindow(windowId, bounds) {
  await chrome.windows.update(windowId, bounds);
  await sleep(SETTLE_MS);
}

async function applyMobile(tabId, win, prevZoom, restore) {
  if (win.state !== 'normal') await setWindow(win.id, { state: 'normal' });
  const w0 = await chrome.windows.get(win.id);
  const m = await measureTab(tabId);
  const frameW = w0.width - m.innerW * prevZoom;
  const frameH = w0.height - m.innerH * prevZoom;
  const availH = m.availH * prevZoom;
  const plan = planMobileWindow({
    frameW, frameH, availH,
    availW: m.availW * prevZoom,
    availLeft: m.availLeft * prevZoom,
    availTop: m.availTop * prevZoom,
  });

  // 缩放只作用于这个标签页，不影响同站点的其他标签
  await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' });
  let zoom = plan.zoom;
  await chrome.tabs.setZoom(tabId, zoom);
  await setWindow(win.id, { left: plan.left, top: plan.top, width: plan.width, height: plan.height });

  // 普通窗口有最小宽度：窗口缩不到 390×缩放 时，提高缩放把 CSS 宽度压回 390
  let target = { ...MOBILE };
  const m2 = await measureTab(tabId);
  if (m2.innerW > MOBILE.width + 2) {
    zoom = zoomForMinWidth(m2.innerW * zoom);
    await chrome.tabs.setZoom(tabId, zoom);
    // 小屏幕放不下：Chrome 允许窗口最多一半超出屏幕，向下超出以保住手机高度（超出部分照样被录进去）
    target = { width: MOBILE.width, height: Math.min(MOBILE.height, Math.floor((availH * MAX_OVERFLOW - frameH) / zoom)) };
    await setWindow(win.id, { width: Math.round(target.width * zoom + frameW), height: Math.round(target.height * zoom + frameH) });
  }

  // 边框估算可能有几个像素误差，按实测视口再校正一次
  const m3 = await measureTab(tabId);
  const dw = Math.round((target.width - m3.innerW) * zoom);
  const dh = Math.round((target.height - m3.innerH) * zoom);
  if (Math.abs(dw) > 1 || Math.abs(dh) > 1) {
    const cur = await chrome.windows.get(win.id);
    await setWindow(win.id, { width: cur.width + dw, height: cur.height + dh });
  }
  const final = await measureTab(tabId);
  return { restore, viewport: { width: final.innerW, height: final.innerH }, zoom, prevZoom };
}

// 窗口实际最小内宽（DIP）→ 让 CSS 宽度等于 390 所需的缩放
export function zoomForMinWidth(minInnerDip) {
  return Math.min(MAX_ZOOM, Math.ceil((minInnerDip / MOBILE.width) * 100) / 100);
}

// 偶数尺寸、最长边不超过 3840，保持宽高比（录屏采集分辨率）
export function captureSize(w, h) {
  const scale = Math.min(1, 3840 / Math.max(w, h));
  const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(w), height: even(h) };
}

// 恢复失败不抛出（结束流程还要继续保存视频），但记录下来便于排查
export const restoreErrors = [];

async function attempt(label, fn) {
  try {
    await fn();
  } catch (err) {
    restoreErrors.push(`${label}: ${err.message}`);
    console.warn('[agent-reveal] 恢复视图失败', label, err);
  }
}

export async function restoreView(info) {
  if (!info) return;
  const { restore, prevZoom } = info;
  await attempt('zoom', () => chrome.tabs.setZoom(restore.tabId, prevZoom));
  await attempt('zoomSettings', () => chrome.tabs.setZoomSettings(restore.tabId, restore.zoomSettings));
  if (restore.state !== 'normal') {
    await attempt('state', () => chrome.windows.update(restore.windowId, { state: restore.state }));
    return;
  }
  // 原位置可能被判定为超出屏幕而拒绝，失败时至少把尺寸还原
  try {
    await chrome.windows.update(restore.windowId, restore.bounds);
  } catch (err) {
    restoreErrors.push(`bounds: ${err.message}`);
    const { width, height } = restore.bounds;
    await attempt('size', () => chrome.windows.update(restore.windowId, { width, height }));
  }
}