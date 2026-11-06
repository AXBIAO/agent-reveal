// 弹窗与后台共用的设置读写（chrome.storage.sync）

// v2：speed 改为"越大越快"（v1 存的是时长倍数，越大越慢，语义相反）
export const SETTINGS_VERSION = 2;

export const VIEWS = Object.freeze(['desktop', 'mobile']);

export const DEFAULT_SETTINGS = Object.freeze({
  record: true,
  maxAgents: 26,
  speed: 1,
  showNames: false,
  view: 'desktop',
  sound: true,
  rulers: true,
  autoScroll: true,
});

const LIMITS = { maxAgents: [4, 40], speed: [0.5, 2] };

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
    speed: Math.round(num(s.speed, LIMITS.speed, DEFAULT_SETTINGS.speed) * 10) / 10,
    showNames: Boolean(s.showNames),
    view: VIEWS.includes(s.view) ? s.view : DEFAULT_SETTINGS.view,
    sound: Boolean(s.sound),
    rulers: Boolean(s.rulers),
    autoScroll: Boolean(s.autoScroll),
  };
}

// 旧版本存的 speed 语义相反，直接丢弃回到默认值，其余设置保留
export function migrate(raw, version) {
  if (!raw || typeof raw !== 'object') return {};
  if (version === SETTINGS_VERSION) return raw;
  const { speed, ...rest } = raw;
  return rest;
}

export async function loadSettings() {
  const { settings, settingsVersion } = await chrome.storage.sync.get(['settings', 'settingsVersion']);
  return sanitize(migrate(settings, settingsVersion));
}

export async function saveSettings(s) {
  const clean = sanitize(s);
  await chrome.storage.sync.set({ settings: clean, settingsVersion: SETTINGS_VERSION });
  return clean;
}
