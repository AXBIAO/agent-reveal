// 间距红线：放下一个元素时，量出它和最近的已完成元素之间的距离（纯函数）

const MAX_GAP = 160;
const MIN_GAP = 4;
const MIN_OVERLAP = 0.2;

function overlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/**
 * @param {{x:number,y:number,w:number,h:number}} rect 新放下的元素（页面坐标）
 * @param {{x:number,y:number,w:number,h:number}[]} placed 已完成的元素
 * @returns {null | {axis:'v'|'h', x1:number, y1:number, x2:number, y2:number, gap:number}}
 *   axis 'v'：竖线（上方邻居到本元素顶边）；'h'：横线（左侧邻居到本元素左边）
 */
export function nearestGap(rect, placed) {
  let best = null;
  for (const p of placed) {
    // 上方邻居：横向有足够重叠
    const ox = overlap(rect.x, rect.x + rect.w, p.x, p.x + p.w);
    if (ox >= Math.min(rect.w, p.w) * MIN_OVERLAP) {
      const gap = rect.y - (p.y + p.h);
      if (gap >= MIN_GAP && gap <= MAX_GAP && (!best || gap < best.gap)) {
        const x = Math.max(rect.x, p.x) + ox / 2;
        best = { axis: 'v', x1: x, y1: p.y + p.h, x2: x, y2: rect.y, gap };
      }
    }
    // 左侧邻居：纵向有足够重叠
    const oy = overlap(rect.y, rect.y + rect.h, p.y, p.y + p.h);
    if (oy >= Math.min(rect.h, p.h) * MIN_OVERLAP) {
      const gap = rect.x - (p.x + p.w);
      if (gap >= MIN_GAP && gap <= MAX_GAP && (!best || gap < best.gap)) {
        const y = Math.max(rect.y, p.y) + oy / 2;
        best = { axis: 'h', x1: p.x + p.w, y1: y, x2: rect.x, y2: y, gap };
      }
    }
  }
  return best ? { ...best, gap: Math.round(best.gap) } : null;
}
