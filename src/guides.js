// 参考线：从真实排版里找对齐关系（纯函数，便于单元测试）
// 竖向线：同一区段里 ≥3 个元素左边缘对齐；横向线：同一区段里 ≥3 个元素顶边对齐（如一排卡片）
// 每个区段最多一条，全页最多 MAX_GUIDES 条

const BAND = 900;
const MIN_MEMBERS = 3;
const MAX_GUIDES = 8;
const MIN_W = 30;

function bestGroup(items, key) {
  const groups = new Map();
  for (const it of items) {
    const k = Math.round(key(it));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  let best = null;
  for (const [pos, list] of groups) {
    if (list.length >= MIN_MEMBERS && (!best || list.length > best.list.length)) best = { pos, list };
  }
  return best;
}

/**
 * @param {{id:number, x:number, y:number, w:number, h:number}[]} items 页面坐标下的元素框
 * @returns {{axis:'x'|'y', pos:number, members:number[], y:number, x:number}[]}
 *   axis 'x' 为竖向线（pos 是横坐标），'y' 为横向线（pos 是纵坐标）；x/y 是出现位置
 */
export function computeGuides(items) {
  const usable = items.filter((it) => it.w >= MIN_W && it.h >= 8);
  const bands = new Map();
  for (const it of usable) {
    const k = Math.floor(it.y / BAND);
    if (!bands.has(k)) bands.set(k, []);
    bands.get(k).push(it);
  }
  const guides = [];
  // 每个区段最多一条：竖向、横向里取对齐元素更多的那个（同样多时优先竖向）。
  // 线太多会让标尺频繁滑进来挡住内容，画面也乱
  for (const k of [...bands.keys()].sort((a, b) => a - b)) {
    if (guides.length >= MAX_GUIDES) break;
    const list = bands.get(k);
    const col = bestGroup(list, (it) => it.x);
    const row = bestGroup(list, (it) => it.y);
    if (col && (!row || col.list.length >= row.list.length)) {
      guides.push({
        axis: 'x', pos: col.pos,
        members: col.list.map((m) => m.id),
        y: Math.min(...col.list.map((m) => m.y)),
        x: col.pos,
      });
    } else if (row) {
      guides.push({
        axis: 'y', pos: row.pos,
        members: row.list.map((m) => m.id),
        y: row.pos,
        x: Math.min(...row.list.map((m) => m.x)),
      });
    }
  }
  return guides.slice(0, MAX_GUIDES);
}
