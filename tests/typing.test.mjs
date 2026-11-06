// 单元测试：打字脚本的不变量（node --test）
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTypingScript, typingProfile } from '../src/typing.js';

const SAMPLES = ['我做什么', '让每个人，都能成为设计师', 'Design Eye', '不需要专业基础，也不必掌握复杂软件。'.repeat(4), '一'];

test('最后一帧总是完整的正确原文', () => {
  for (const text of SAMPLES) {
    for (const heading of [true, false]) {
      for (let i = 0; i < 200; i += 1) {
        const { frames } = buildTypingScript(text, heading);
        const last = frames[frames.length - 1];
        assert.equal(last.shown, text);
        assert.equal(last.restFrom, Array.from(text).length);
      }
    }
  }
});

test('每一帧 = 原文前缀 + 若干打错的字，且未显示部分从前缀末尾开始', () => {
  for (let i = 0; i < 300; i += 1) {
    const text = SAMPLES[i % SAMPLES.length];
    const chars = Array.from(text);
    for (const f of buildTypingScript(text, i % 2 === 0).frames) {
      const prefix = chars.slice(0, f.restFrom).join('');
      assert.ok(f.shown.startsWith(prefix), `frame "${f.shown}" 不以 "${prefix}" 开头`);
      assert.ok(Array.from(f.shown).length - f.restFrom <= 2, '一次最多打错 2 个字');
      assert.ok(f.delay > 0);
    }
  }
});

test('打错次数不超过上限，标题大概率会出现打错再改', () => {
  let headingWithTypo = 0;
  for (let i = 0; i < 300; i += 1) {
    const { typos } = buildTypingScript('让每个人，都能成为设计师', true);
    assert.ok(typos <= typingProfile(12, true).maxTypos);
    if (typos > 0) headingWithTypo += 1;
  }
  assert.ok(headingWithTypo / 300 > 0.6, `标题出错比例 ${headingWithTypo / 300}`);
});

test('单字或空串不会出错也不会卡住', () => {
  assert.equal(buildTypingScript('一', true).typos, 0);
  assert.deepEqual(buildTypingScript('', true).frames, []);
});
