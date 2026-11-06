// 设计软件式标尺：顶部 + 左侧，刻度为页面坐标，选区在标尺上投影成彩色区间

export const RULER = 20;
const BG = 'rgba(250,250,250,0.94)';
const LINE = '#d4d4d8';
const TICK = '#a1a1aa';
const LABEL = '#71717a';

/**
 * 标尺刻度（纯函数）：给定可见区间的页面起点与长度，返回每个刻度在屏幕上的位置
 * @param {number} start 可见区间起点（页面坐标）
 * @param {number} length 可见长度（像素）
 * @param {number} step 最小刻度间隔
 * @returns {{pos:number,value:number,level:0|1|2}[]} level 2=大刻度(带数字) 1=中 0=小
 */
export function rulerTicks(start, length, step = 10) {
  const ticks = [];
  const first = Math.ceil(start / step) * step;
  for (let v = first; v <= start + length; v += step) {
    const level = v % 100 === 0 ? 2 : v % 50 === 0 ? 1 : 0;
    ticks.push({ pos: v - start, value: v, level });
  }
  return ticks;
}

function makeCanvas(css) {
  const c = document.createElement('canvas');
  c.style.cssText = `position:fixed;pointer-events:none;${css}`;
  return c;
}

function fit(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

function drawTop(g, w, scrollX, bands) {
  g.clearRect(0, 0, w, RULER);
  g.fillStyle = BG;
  g.fillRect(0, 0, w, RULER);
  for (const b of bands) {
    g.fillStyle = `${b.color}33`;
    g.fillRect(b.from - RULER, 0, b.to - b.from, RULER);
  }
  g.strokeStyle = TICK;
  g.fillStyle = LABEL;
  g.font = '9px -apple-system,"Segoe UI",sans-serif';
  g.lineWidth = 1;
  g.beginPath();
  for (const t of rulerTicks(scrollX + RULER, w, 10)) {
    const x = Math.round(t.pos) + 0.5;
    const len = t.level === 2 ? RULER : t.level === 1 ? 8 : 4;
    g.moveTo(x, RULER);
    g.lineTo(x, RULER - len);
    if (t.level === 2) g.fillText(String(t.value), x + 3, 9);
  }
  g.stroke();
  for (const b of bands) {
    g.fillStyle = b.color;
    g.fillRect(b.from - RULER, RULER - 2, b.to - b.from, 2);
  }
  g.fillStyle = LINE;
  g.fillRect(0, RULER - 1, w, 1);
}

function drawLeft(g, h, scrollY, bands) {
  g.clearRect(0, 0, RULER, h);
  g.fillStyle = BG;
  g.fillRect(0, 0, RULER, h);
  for (const b of bands) {
    g.fillStyle = `${b.color}33`;
    g.fillRect(0, b.from - RULER, RULER, b.to - b.from);
  }
  g.strokeStyle = TICK;
  g.fillStyle = LABEL;
  g.font = '9px -apple-system,"Segoe UI",sans-serif';
  g.beginPath();
  for (const t of rulerTicks(scrollY + RULER, h, 10)) {
    const y = Math.round(t.pos) + 0.5;
    const len = t.level === 2 ? RULER : t.level === 1 ? 8 : 4;
    g.moveTo(RULER, y);
    g.lineTo(RULER - len, y);
    if (t.level === 2) {
      g.save();
      g.translate(9, y + 3);
      g.rotate(-Math.PI / 2);
      g.fillText(String(t.value), 0, 0);
      g.restore();
    }
  }
  g.stroke();
  for (const b of bands) {
    g.fillStyle = b.color;
    g.fillRect(RULER - 2, b.from - RULER, 2, b.to - b.from);
  }
  g.fillStyle = LINE;
  g.fillRect(RULER - 1, 0, 1, h);
}

/**
 * 创建标尺。draw(bands) 每帧调用；bands 为屏幕坐标的选区投影
 * @param {HTMLElement} overlay
 * @returns {{ draw(bands: {axis:'x'|'y', from:number, to:number, color:string}[]): void, show(on:boolean): void }}
 */
export function createRulers(overlay) {
  const wrap = document.createElement('div');
  // 平时藏在屏幕外，只在拉参考线时滑进来（常驻会挡住网站顶部和左侧的内容）
  const SLIDE = 'transition:transform .35s cubic-bezier(.2,.8,.2,1);will-change:transform;';
  wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
  const top = makeCanvas(`left:${RULER}px;top:0;transform:translateY(-${RULER + 2}px);${SLIDE}`);
  const left = makeCanvas(`left:0;top:${RULER}px;transform:translateX(-${RULER + 2}px);${SLIDE}`);
  const corner = document.createElement('div');
  corner.style.cssText = `position:fixed;left:0;top:0;width:${RULER}px;height:${RULER}px;background:${BG};border-right:1px solid ${LINE};border-bottom:1px solid ${LINE};box-sizing:border-box;transform:translate(-${RULER + 2}px,-${RULER + 2}px);${SLIDE}`;
  wrap.append(top, left, corner);
  overlay.appendChild(wrap);
  let last = '';
  return {
    show(on) {
      top.style.transform = on ? 'none' : `translateY(-${RULER + 2}px)`;
      left.style.transform = on ? 'none' : `translateX(-${RULER + 2}px)`;
      corner.style.transform = on ? 'none' : `translate(-${RULER + 2}px,-${RULER + 2}px)`;
    },
    draw(bands) {
      const w = innerWidth - RULER;
      const h = innerHeight - RULER;
      const key = `${scrollX}|${scrollY}|${w}|${h}|${bands.map((b) => `${b.axis}${b.from | 0}-${b.to | 0}${b.color}`).join()}`;
      if (key === last) return; // 没变化就不重画
      last = key;
      drawTop(fit(top, w, RULER), w, scrollX, bands.filter((b) => b.axis === 'x'));
      drawLeft(fit(left, RULER, h), h, scrollY, bands.filter((b) => b.axis === 'y'));
    },
  };
}
