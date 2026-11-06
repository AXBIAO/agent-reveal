// 单元测试：标尺刻度、参考线推算、间距红线、开场溶解、音效音高与节拍
import test from 'node:test';
import assert from 'node:assert/strict';
import { rulerTicks } from '../src/rulers.js';
import { computeGuides } from '../src/guides.js';
import { nearestGap } from '../src/redline.js';
import { dissolveDelay } from '../src/intro.js';
import { placeNote, nextGridTime, panFor } from '../src/sound.js';
import { findRepeatGroups, penSide, lineEnds } from '../src/repeats.js';

test('标尺刻度：每 10px 一格，50 为中刻度，100 为大刻度', () => {
  const t = rulerTicks(95, 120);
  assert.deepEqual(t.map((x) => x.value), [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210]);
  assert.equal(t[0].pos, 5);
  assert.equal(t.find((x) => x.value === 100).level, 2);
  assert.equal(t.find((x) => x.value === 150).level, 1);
  assert.equal(t.find((x) => x.value === 110).level, 0);
});

test('参考线：同一区段 3 个以上左对齐的元素生成竖向线', () => {
  const items = [
    { id: 1, x: 120, y: 100, w: 400, h: 40 },
    { id: 2, x: 120, y: 160, w: 300, h: 20 },
    { id: 3, x: 120.4, y: 200, w: 200, h: 20 },
    { id: 4, x: 700, y: 120, w: 200, h: 200 },
  ];
  const g = computeGuides(items).find((x) => x.axis === 'x');
  assert.ok(g);
  assert.equal(g.pos, 120);
  assert.deepEqual(g.members.sort(), [1, 2, 3]);
  assert.equal(g.y, 100);
});

test('参考线：一排顶边对齐的卡片生成横向线；不足 3 个不生成', () => {
  const cards = [0, 1, 2].map((i) => ({ id: i, x: 130 + i * 400, y: 1500, w: 380, h: 500 }));
  const g = computeGuides(cards).find((x) => x.axis === 'y');
  assert.ok(g);
  assert.equal(g.pos, 1500);
  assert.equal(g.x, 130);
  assert.equal(computeGuides(cards.slice(0, 2)).length, 0);
});

test('参考线：每个区段最多一条，竖向与横向取对齐元素更多的', () => {
  const items = [
    ...[0, 1, 2].map((i) => ({ id: i, x: 100, y: 100 + i * 60, w: 300, h: 30 })),
    ...[0, 1, 2, 3].map((i) => ({ id: 10 + i, x: 500 + i * 200, y: 400, w: 180, h: 200 })),
  ];
  const g = computeGuides(items);
  assert.equal(g.length, 1);
  assert.equal(g[0].axis, 'y');
  assert.equal(g[0].members.length, 4);
});

test('参考线：太窄的元素不参与，数量有上限', () => {
  assert.equal(computeGuides([1, 2, 3].map((id) => ({ id, x: 50, y: id * 30, w: 10, h: 20 }))).length, 0);
  const many = [];
  for (let band = 0; band < 30; band += 1) {
    for (let k = 0; k < 3; k += 1) many.push({ id: band * 10 + k, x: 40 + band, y: band * 900 + k * 40, w: 200, h: 20 });
  }
  assert.ok(computeGuides(many).length <= 8);
});

test('间距红线：取最近的上方邻居，返回竖线和整数距离', () => {
  const rect = { x: 100, y: 300, w: 200, h: 40 };
  const placed = [
    { x: 100, y: 100, w: 200, h: 40 },  // 距离 160
    { x: 120, y: 200, w: 150, h: 76 },  // 距离 24（更近）
  ];
  const g = nearestGap(rect, placed);
  assert.equal(g.axis, 'v');
  assert.equal(g.gap, 24);
  assert.equal(g.y1, 276);
  assert.equal(g.y2, 300);
});

test('间距红线：左侧邻居给横线；太远、重叠或贴边返回 null', () => {
  const g = nearestGap({ x: 300, y: 100, w: 100, h: 40 }, [{ x: 100, y: 100, w: 180, h: 40 }]);
  assert.equal(g.axis, 'h');
  assert.equal(g.gap, 20);
  assert.equal(nearestGap({ x: 100, y: 600, w: 100, h: 40 }, [{ x: 100, y: 100, w: 100, h: 40 }]), null);
  assert.equal(nearestGap({ x: 100, y: 142, w: 100, h: 40 }, [{ x: 100, y: 100, w: 100, h: 40 }]), null);
  assert.equal(nearestGap({ x: 100, y: 100, w: 100, h: 40 }, []), null);
});

test('开场溶解：视口内按纵向位置递增，视口外不做动画', () => {
  assert.equal(dissolveDelay(0, 900), 0);
  assert.ok(dissolveDelay(450, 900) > dissolveDelay(100, 900));
  assert.equal(dissolveDelay(1200, 900), null);
  assert.equal(dissolveDelay(-1000, 900), null);
});

test('音效：面积越大音越低，越靠右音越高，声像随位置', () => {
  assert.ok(placeNote(0.2, 0.5) < placeNote(0.001, 0.5));
  assert.ok(placeNote(0.01, 0.9) > placeNote(0.01, 0.1));
  assert.ok(panFor(0) < 0 && panFor(1) > 0 && panFor(0.5) === 0);
});

test('音效：节拍网格时刻在当前时刻之后，相邻网格间隔为 8 分音符', () => {
  const a = nextGridTime(1.0, 0, 120, 2);
  assert.ok(a.when > 1.0);
  const b = nextGridTime(a.when + 0.001, 0, 120, 2);
  assert.ok(Math.abs(b.when - a.when - 0.25) < 1e-9);
  assert.equal(b.slot, a.slot + 1);
});

test('重复组件：同父元素、同标签同 class、尺寸相近的 3 个以上元素，第一个为原件', () => {
  const chips = [0, 1, 2, 3].map((i) => ({ id: i, parent: 'p1', tag: 'A', cls: 'chip', w: 90 + i * 4, h: 32, order: 10 + i }));
  const groups = findRepeatGroups(chips);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].master, 0);
  assert.deepEqual(groups[0].copies, [1, 2, 3]);
});

test('重复组件：不同父元素、尺寸差太多、不足 3 个、没有 class 都不算', () => {
  const base = { tag: 'DIV', cls: 'card', h: 300, w: 380 };
  assert.equal(findRepeatGroups([0, 1, 2].map((i) => ({ ...base, id: i, parent: `p${i}`, order: i }))).length, 0);
  assert.equal(findRepeatGroups([0, 1].map((i) => ({ ...base, id: i, parent: 'p', order: i }))).length, 0);
  assert.equal(findRepeatGroups([0, 1, 2].map((i) => ({ ...base, id: i, parent: 'p', cls: '', order: i }))).length, 0);
  const uneven = [{ ...base, id: 0, parent: 'p', order: 0 }, { ...base, id: 1, parent: 'p', order: 1, w: 800 }, { ...base, id: 2, parent: 'p', order: 2, w: 900 }];
  assert.equal(findRepeatGroups(uneven).length, 0);
});

test('钢笔线：<hr>、细条、单边边框画线；有背景或多边边框不画', () => {
  const none = { top: false, right: false, bottom: false, left: false };
  const s = (o) => ({ tag: 'DIV', w: 400, h: 60, borders: none, hasBg: false, hasImg: false, hasShadow: false, ...o });
  assert.equal(penSide(s({ tag: 'HR' })), 'mid');
  assert.equal(penSide(s({ h: 1, hasBg: true })), 'mid');
  assert.equal(penSide(s({ borders: { ...none, bottom: true } })), 'bottom');
  assert.equal(penSide(s({ borders: { ...none, left: true }, h: 200 })), 'left');
  assert.equal(penSide(s({ borders: { ...none, bottom: true }, hasBg: true })), null);
  assert.equal(penSide(s({ borders: { ...none, top: true, bottom: true } })), null);
  assert.equal(penSide(s({ borders: { ...none, bottom: true }, w: 20 })), null);
});

test('钢笔线端点：贴着对应的边，细线取中线', () => {
  const r = { left: 10, top: 20, right: 210, bottom: 80, width: 200, height: 60 };
  assert.deepEqual(lineEnds(r, 'bottom'), { a: { x: 10, y: 79.5 }, b: { x: 210, y: 79.5 } });
  assert.deepEqual(lineEnds(r, 'left'), { a: { x: 10.5, y: 20 }, b: { x: 10.5, y: 80 } });
  const thin = { left: 0, top: 100, right: 300, bottom: 101, width: 300, height: 1 };
  assert.deepEqual(lineEnds(thin, 'mid'), { a: { x: 0, y: 100.5 }, b: { x: 300, y: 100.5 } });
});