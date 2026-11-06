// 单元测试：扩展的纯逻辑（文件命名、设置校验）
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingFileName } from '../extension/naming.js';
import { sanitize, DEFAULT_SETTINGS } from '../extension/settings.js';

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
  assert.deepEqual(sanitize({ maxAgents: '999', speed: '0.01' }), { ...DEFAULT_SETTINGS, maxAgents: 40, speed: 0.3 });
  assert.deepEqual(sanitize({ maxAgents: 'abc', speed: NaN, record: 0 }), { ...DEFAULT_SETTINGS, record: false });
  assert.equal(sanitize({ speed: '0.777' }).speed, 0.78);
});
