// 重复组件识别（纯函数）：同一父元素下 ≥3 个标签、class 相同且尺寸相近的元素
// → 第一个为原件，其余为复制品（动画里用 ⌥ 拖拽复制出来）

const MIN_GROUP = 3;
const SIZE_TOLERANCE = 0.15;
const MAX_COPIES = 12;

const close = (a, b) => Math.abs(a - b) <= Math.max(a, b) * SIZE_TOLERANCE;

/**
 * @param {{id:number, parent:string, tag:string, cls:string, w:number, h:number, order:number}[]} items
 *   parent：父元素标识；order：搭建顺序（越小越早）
 * @returns {{master:number, copies:number[]}[]}
 */
export function findRepeatGroups(items) {
  const byKey = new Map();
  for (const it of items) {
    if (!it.cls || it.w < 20 || it.h < 12) continue;
    const key = `${it.parent}|${it.tag}|${it.cls}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(it);
  }
  const groups = [];
  for (const list of byKey.values()) {
    if (list.length < MIN_GROUP) continue;
    const sorted = [...list].sort((a, b) => a.order - b.order);
    const master = sorted[0];
    const copies = sorted.slice(1).filter((c) => close(c.w, master.w) && close(c.h, master.h));
    if (copies.length + 1 < MIN_GROUP) continue;
    groups.push({ master: master.id, copies: copies.slice(0, MAX_COPIES).map((c) => c.id) });
  }
  return groups;
}

/**
 * 钢笔线的两个端点（屏幕坐标）。side：top/right/bottom/left 为单边边框，mid 为细线或 <hr>
 * @param {{left:number, top:number, right:number, bottom:number, width:number, height:number}} r
 * @param {'top'|'right'|'bottom'|'left'|'mid'} side
 */
export function lineEnds(r, side) {
  if (side === 'top') return { a: { x: r.left, y: r.top + 0.5 }, b: { x: r.right, y: r.top + 0.5 } };
  if (side === 'bottom') return { a: { x: r.left, y: r.bottom - 0.5 }, b: { x: r.right, y: r.bottom - 0.5 } };
  if (side === 'left') return { a: { x: r.left + 0.5, y: r.top }, b: { x: r.left + 0.5, y: r.bottom } };
  if (side === 'right') return { a: { x: r.right - 0.5, y: r.top }, b: { x: r.right - 0.5, y: r.bottom } };
  const horizontal = r.width >= r.height;
  return horizontal
    ? { a: { x: r.left, y: r.top + r.height / 2 }, b: { x: r.right, y: r.top + r.height / 2 } }
    : { a: { x: r.left + r.width / 2, y: r.top }, b: { x: r.left + r.width / 2, y: r.bottom } };
}

/**
 * 判断一个块是否应该用钢笔画成一条线（纯函数，输入为计算样式里的数值）
 * @param {{tag:string, w:number, h:number, borders:{top:boolean,right:boolean,bottom:boolean,left:boolean},
 *   hasBg:boolean, hasImg:boolean, hasShadow:boolean}} s
 * @returns {null|'top'|'right'|'bottom'|'left'|'mid'}
 */
export function penSide(s) {
  if (s.tag === 'HR') return 'mid';
  const thin = (s.h <= 3 && s.w >= 24) || (s.w <= 3 && s.h >= 24);
  if (thin && (s.hasBg || Object.values(s.borders).some(Boolean))) return 'mid';
  if (s.hasBg || s.hasImg || s.hasShadow) return null;
  const sides = Object.entries(s.borders).filter(([, on]) => on).map(([k]) => k);
  if (sides.length !== 1) return null;
  const side = sides[0];
  // 线要有足够长度才值得画
  if ((side === 'top' || side === 'bottom') && s.w < 40) return null;
  if ((side === 'left' || side === 'right') && s.h < 40) return null;
  return side;
}
