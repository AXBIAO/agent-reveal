// 设计辅助层：参考线、间距红线的 DOM 渲染。坐标存页面坐标，每帧换算成屏幕坐标

import { RULER } from './rulers.js';

const GUIDE = '#f2387c';
const RED = '#f23b3b';
const REDLINE_MS = 900;
const MAX_REDLINES = 4;

const el = (css, html = '') => {
  const n = document.createElement('div');
  n.style.cssText = css;
  n.innerHTML = html;
  return n;
};

function guideEl(axis) {
  const line = axis === 'x'
    ? `position:fixed;top:0;bottom:0;width:1px;left:0;background:${GUIDE};`
    : `position:fixed;left:0;right:0;height:1px;top:0;background:${GUIDE};`;
  const node = el(`${line}opacity:0;transition:opacity .25s,box-shadow .2s;will-change:transform;`);
  const label = el(`position:fixed;padding:0 4px;border-radius:3px;background:${GUIDE};color:#fff;font:9px/14px -apple-system,"Segoe UI",sans-serif;white-space:nowrap;`);
  return { node, label };
}

export function createDesignLayer(overlay) {
  const root = el('position:fixed;inset:0;pointer-events:none;');
  overlay.appendChild(root);
  const guides = new Set();
  let redlines = [];

  function placeGuide(gd) {
    const screen = gd.axis === 'x' ? gd.page - scrollX : gd.page - scrollY;
    if (gd.axis === 'x') {
      gd.node.style.transform = `translateX(${screen}px)`;
      gd.label.style.transform = `translate(${screen + 3}px, 3px)`;
    } else {
      gd.node.style.transform = `translateY(${screen}px)`;
      gd.label.style.transform = `translate(3px, ${screen + 3}px)`;
    }
    gd.label.textContent = String(Math.round(gd.page));
  }

  function placeRedline(r) {
    const x1 = r.x1 - scrollX;
    const y1 = r.y1 - scrollY;
    const len = r.axis === 'v' ? r.y2 - r.y1 : r.x2 - r.x1;
    r.node.style.transform = `translate(${x1}px, ${y1}px)`;
    if (r.axis === 'v') r.node.style.height = `${len}px`;
    else r.node.style.width = `${len}px`;
  }

  return {
    /** 新建一条参考线，初始停在标尺上；返回控制句柄 */
    addGuide(axis) {
      const { node, label } = guideEl(axis);
      root.append(node, label);
      const gd = { axis, node, label, page: axis === 'x' ? scrollX + RULER / 2 : scrollY + RULER / 2 };
      guides.add(gd);
      node.style.opacity = '0.9';
      placeGuide(gd);
      return {
        setScreen(pos) { gd.page = (axis === 'x' ? scrollX : scrollY) + pos; placeGuide(gd); },
        setPage(pos) { gd.page = pos; placeGuide(gd); },
        flash() {
          node.style.boxShadow = `0 0 0 1px ${GUIDE}, 0 0 8px ${GUIDE}`;
          setTimeout(() => { node.style.boxShadow = 'none'; }, 220);
        },
        remove() {
          node.style.opacity = '0';
          label.style.opacity = '0';
          setTimeout(() => { node.remove(); label.remove(); guides.delete(gd); }, 300);
        },
      };
    },

    /** 显示一条间距红线（页面坐标） */
    redline(gap) {
      if (!gap) return;
      if (redlines.length >= MAX_REDLINES) return;
      const vertical = gap.axis === 'v';
      const cap = vertical ? 'width:7px;height:1px;left:-3px;' : 'width:1px;height:7px;top:-3px;';
      const node = el(
        `position:fixed;left:0;top:0;${vertical ? 'width:1px;' : 'height:1px;'}background:${RED};opacity:0;transition:opacity .15s;`,
        `<i style="position:absolute;${cap}${vertical ? 'top:0' : 'left:0'};background:${RED}"></i>`
        + `<i style="position:absolute;${cap}${vertical ? 'bottom:0' : 'right:0'};background:${RED}"></i>`
        + `<span style="position:absolute;${vertical ? 'left:4px;top:50%;transform:translateY(-50%)' : 'top:3px;left:50%;transform:translateX(-50%)'};padding:0 4px;border-radius:3px;background:${RED};color:#fff;font:9px/14px -apple-system,'Segoe UI',sans-serif;white-space:nowrap">${gap.gap}</span>`,
      );
      root.appendChild(node);
      const r = { ...gap, node, born: performance.now() };
      redlines = [...redlines, r];
      placeRedline(r);
      requestAnimationFrame(() => { node.style.opacity = '1'; });
    },

    /** 钢笔线（屏幕坐标）：起点锚点 → 跟随光标的橡皮筋 → 终点锚点后变实线 */
    pen(color) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('style', 'position:fixed;inset:0;width:100%;height:100%;overflow:visible;transition:opacity .25s;');
      svg.innerHTML = `<line stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3" opacity=".8"></line>`
        + `<rect width="7" height="7" fill="#fff" stroke="${color}" stroke-width="1.5" style="display:none"></rect>`
        + `<rect width="7" height="7" fill="#fff" stroke="${color}" stroke-width="1.5" style="display:none"></rect>`;
      root.appendChild(svg);
      const [line, a1, a2] = svg.children;
      const place = (rect, p) => { rect.setAttribute('x', p.x - 3.5); rect.setAttribute('y', p.y - 3.5); rect.style.display = ''; };
      const setLine = (p, q) => {
        line.setAttribute('x1', p.x); line.setAttribute('y1', p.y);
        line.setAttribute('x2', q.x); line.setAttribute('y2', q.y);
      };
      return {
        anchorA(p) { place(a1, p); setLine(p, p); },
        rubber(p, q) { place(a1, p); setLine(p, q); },
        anchorB(p, q) {
          place(a1, p);
          place(a2, q);
          setLine(p, q);
          line.removeAttribute('stroke-dasharray');
          line.setAttribute('opacity', '1');
        },
        remove() {
          svg.style.opacity = '0';
          setTimeout(() => svg.remove(), 260);
        },
      };
    },

    /** 复制时跟着光标走的副本框（屏幕坐标） */
    ghost(color) {
      const node = el(`position:fixed;left:0;top:0;border:1.5px dashed ${color};background:${color}18;border-radius:2px;box-sizing:border-box;transition:opacity .2s;`);
      root.appendChild(node);
      return {
        setRect(x, y, w, h) {
          node.style.transform = `translate(${x}px, ${y}px)`;
          node.style.width = `${w}px`;
          node.style.height = `${h}px`;
        },
        remove() {
          node.style.opacity = '0';
          setTimeout(() => node.remove(), 220);
        },
      };
    },

    /** 每帧调用：跟随滚动、清理过期红线 */
    update() {
      for (const gd of guides) placeGuide(gd);
      const now = performance.now();
      const alive = [];
      for (const r of redlines) {
        if (now - r.born > REDLINE_MS) {
          r.node.style.opacity = '0';
          setTimeout(() => r.node.remove(), 200);
        } else {
          placeRedline(r);
          alive.push(r);
        }
      }
      redlines = alive;
    },
  };
}
