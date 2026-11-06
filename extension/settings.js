// 弹窗与后台共用的设置读写（chrome.storage.sync）

export const DEFAULT_SETTINGS = Object.freeze({
  record: true,
  maxAgents: 26,
  speed: 0.7,
  showNames: false,
});

const LIMITS = { maxAgents: [4, 40], speed: [0.3, 1.5] };

// 外部数据（存储里的旧值、表单输入）一律校验后再用
export function sanitize(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  const num = (v, [lo, hi], d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    record: Boolean(s.record),
    maxAgents: Math.round(num(s.maxAgents, LIMITS.maxAgents, DEFAULT_SETTINGS.maxAgents)),
    speed: Math.round(num(s.speed, LIMITS.speed, DEFAULT_SETTINGS.speed) * 100) / 100,
    showNames: Boolean(s.showNames),
  };
}

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return sanitize(settings);
}

export async function saveSettings(s) {
  const clean = sanitize(s);
  await chrome.storage.sync.set({ settings: clean });
  return clean;
}
