// 单元测试：扩展与动画的纯逻辑（文件命名、设置校验/迁移、速度换算、手机窗口尺寸）
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingFileName } from '../extension/naming.js';
import { sanitize, migrate, DEFAULT_SETTINGS, SETTINGS_VERSION } from '../extension/settings.js';
import { durationScale, BASE_PACE } from '../src/pace.js';
import { planMobileWindow, MOBILE, zoomForMinWidth, captureSize } from '../extension/viewport.js';

test('手机窗口：窗口最小宽度限制时，提高缩放让 CSS 宽度回到 390', () => {
  // 窗口最窄只能到 512 DIP 内宽 → 缩放 1.32，512/1.32 ≈ 388 ≤ 390
  const z = zoomForMinWidth(512);
  assert.equal(z, 1.32);
  assert.ok(512 / z <= MOBILE.width);
  assert.equal(zoomForMinWidth(5000), 3);
});

test('录屏采集尺寸：保持宽高比、偶数、最长边不超过 3840', () => {
  assert.deepEqual(captureSize(2160, 1350), { width: 2160, height: 1350 });
  assert.deepEqual(captureSize(605, 1309), { width: 606, height: 1310 });
  assert.deepEqual(captureSize(5760, 3600), { width: 3840, height: 2400 });
  assert.deepEqual(captureSize(1, 1), { width: 2, height: 2 });
});

test('录屏文件名：子目录 + 域名 + 时间戳 + 扩展名', () => {
  const d = new Date(2026, 10, 6, 9, 5, 7);
  assert.equal(recordingFileName('eye.zsf.si', 'video/mp4;codecs=avc1', d), 'agent-reveal/agent-reveal-eye.zsf.si-20261106-090507.mp4');
  assert.equal(recordingFileName('eye.zsf.si', 'video/webm;codecs=vp9', d), 'agent-reveal/agent-reveal-eye.zsf.si-20261106-090507.webm');
});

test('录屏文件名：域名里的非法字符被去掉，空域名回退 page', () => {
  const d = new Date(2026, 0, 1, 0, 0, 0);
  assert.equal(recordingFileName('a/b:c?*.com', 'video/mp4', d), 'agent-reveal/agent-reveal-abc.com-20260101-000000.mp4');
  assert.equal(recordingFileName('', 'video/mp4', d), 'agent-reveal/agent-reveal-page-20260101-000000.mp4');
});

test('设置校验：缺省值、越界截断、非法值回退', () => {
  assert.deepEqual(sanitize(undefined), { ...DEFAULT_SETTINGS });
  assert.deepEqual(sanitize({ maxAgents: '999', speed: '0.01' }), { ...DEFAULT_SETTINGS, maxAgents: 40, speed: 0.5 });
  assert.deepEqual(sanitize({ maxAgents: 'abc', speed: NaN, record: 0 }), { ...DEFAULT_SETTINGS, record: false });
  assert.equal(sanitize({ speed: '9' }).speed, 2);
  assert.equal(sanitize({ speed: '1.26' }).speed, 1.3);
});

test('设置校验：视图只接受 desktop / mobile', () => {
  assert.equal(sanitize({ view: 'mobile' }).view, 'mobile');
  assert.equal(sanitize({ view: 'tablet' }).view, 'desktop');
  assert.equal(sanitize({}).view, 'desktop');
});

test('设置迁移：旧版本的 speed（语义相反）被丢弃，其余保留', () => {
  const old = { record: false, maxAgents: 12, speed: 1.5, showNames: true };
  assert.deepEqual(sanitize(migrate(old, undefined)), { ...DEFAULT_SETTINGS, record: false, maxAgents: 12, showNames: true });
  assert.equal(sanitize(migrate({ speed: 1.8 }, SETTINGS_VERSION)).speed, 1.8);
  assert.deepEqual(migrate(null, undefined), {});
});

test('速度换算：越大越快（时长倍数单调递减），1× 等于旧默认节奏', () => {
  assert.equal(durationScale(1), BASE_PACE);
  const speeds = [0.5, 0.8, 1, 1.5, 2];
  const paces = speeds.map(durationScale);
  for (let i = 1; i < paces.length; i += 1) assert.ok(paces[i] < paces[i - 1], `speed ${speeds[i]} 应比 ${speeds[i - 1]} 快`);
  assert.equal(durationScale(2), BASE_PACE / 2);
  assert.equal(durationScale(99), durationScale(2));
  assert.equal(durationScale('abc'), BASE_PACE);
  assert.equal(durationScale(0), BASE_PACE);
});

test('手机窗口：按屏幕高度放大，CSS 视口保持 390×844 并水平居中', () => {
  // 3840×2160 @150% → 可用 2560×1400 DIP，边框 16×88
  const p = planMobileWindow({ frameW: 16, frameH: 88, availW: 2560, availH: 1400, availLeft: 0, availTop: 0 });
  assert.equal(p.zoom, 1.55);
  assert.equal(p.width, Math.round(MOBILE.width * (1312 / 844) + 16));
  assert.equal(p.height, 1400);
  assert.equal(p.left, Math.round((2560 - p.width) / 2));
});

test('手机窗口：小屏幕不缩小到 1 倍以下，超大屏幕最多 3 倍', () => {
  assert.equal(planMobileWindow({ frameW: 16, frameH: 88, availW: 1366, availH: 728, availLeft: 0, availTop: 0 }).zoom, 1);
  assert.equal(planMobileWindow({ frameW: 16, frameH: 88, availW: 6000, availH: 5000, availLeft: 0, availTop: 0 }).zoom, 3);
});
