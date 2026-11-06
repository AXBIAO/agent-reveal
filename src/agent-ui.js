// 光标与选框的界面：创建、定位、切换工具形态、选框模式（拖拽 / 选中 / 线框占位）

import { cursorSvg, HOTSPOT } from './cursors.js';

export const BOX_PAD = 3; // 选框比元素外扩的像素

const rand = (a, b) => a + Math.random() * (b - a);

function el(css, html = '') {
  const n = document.createElement('div');
  n.style.cssText = css;
  n.innerHTML = html;
  return n;
}

// 图片占位：浅灰底 + 对角 ✕，和设计稿里的图片占位符一致
const PLACEHOLDER = {
  media: 'background-color:rgba(228,228,231,.85);background-image:linear-gradient(to top right,transparent calc(50% - .6px),rgba(161,161,170,.9) 50%,transparent calc(50% + .6px)),linear-gradient(to bottom right,transparent calc(50% - .6px),rgba(161,161,170,.9) 50%,transparent calc(50% + .6px));',
  block: 'background-color:rgba(228,228,231,.6);background-image:none;',
  control: 'background-color:rgba(228,228,231,.75);background-image:none;',
};

// 插入光标的闪烁动画（每次按键重启动画，所以打字时常亮、停顿时才闪）
function ensureStyles(overlay) {
  if (overlay.querySelector('style[data-ar]')) return;
  const st = document.createElement('style');
  st.setAttribute('data-ar', '');
  st.textContent = '@keyframes ar-caret{0%,55%{opacity:1}56%,100%{opacity:0}}';
  overlay.appendChild(st);
}

export function createAgent(overlay, id, color, showNames) {
  ensureStyles(overlay);
  const cursor = el('position:fixed;left:0;top:0;will-change:transform;transition:opacity .3s;opacity:0;');
  const icon = el('position:absolute;left:0;top:0;', cursorSvg('arrow', color));
  // 光标旁的小标记（如复制时的 ⌥）
  const badge = el(`position:absolute;left:18px;top:-6px;padding:0 5px;border-radius:4px;background:${color};color:#fff;font:600 11px/16px -apple-system,'Segoe UI',sans-serif;opacity:0;transition:opacity .15s;white-space:nowrap`);
  cursor.append(icon, badge);
  if (showNames) {
    cursor.appendChild(el(`position:absolute;left:16px;top:18px;padding:1px 6px;border-radius:5px;background:${color};color:#fff;white-space:nowrap`, `Agent ${id + 1}`));
  }
  const box = el(`position:fixed;left:0;top:0;border:1.5px solid ${color};border-radius:2px;opacity:0;transition:opacity .18s,background-color .25s;box-sizing:border-box;`);
  const handle = `position:absolute;width:6px;height:6px;background:#fff;border:1.5px solid ${color};box-sizing:border-box;transition:opacity .15s;`;
  box.innerHTML = `
    <i data-h style="${handle}left:-4px;top:-4px"></i><i data-h style="${handle}right:-4px;top:-4px"></i>
    <i data-h style="${handle}left:-4px;bottom:-4px"></i><i data-h style="${handle}right:-4px;bottom:-4px"></i>
    <span data-k="size" style="position:absolute;left:50%;top:100%;transform:translate(-50%,6px);padding:1px 5px;border-radius:3px;background:${color};color:#fff;font-size:10px;white-space:nowrap"></span>`;
  const caret = el(`position:fixed;left:0;top:0;width:2px;background:${color};border-radius:1px;opacity:0;`);
  overlay.append(box, caret, cursor);
  const edge = Math.floor(Math.random() * 4);
  const x = edge === 1 ? innerWidth + 20 : edge === 3 ? -20 : rand(0, innerWidth);
  const y = edge === 0 ? -20 : edge === 2 ? innerHeight + 20 : rand(0, innerHeight);
  return {
    id, color, cursor, icon, badge, box, caret, x, y,
    tool: 'arrow',
    sizeLabel: box.querySelector('[data-k="size"]'),
    handles: [...box.querySelectorAll('[data-h]')],
    mode: 'idle',   // idle | drag | select | placeholder
    boxLayer: null,
    anchor: null,   // 拖拽起点（元素上的相对角）
  };
}

export function placeCursor(agent) {
  const [hx, hy] = HOTSPOT[agent.tool] || HOTSPOT.arrow;
  const s = agent.pressed ? 0.86 : 1;
  agent.cursor.style.transform = `translate(${agent.x - hx}px, ${agent.y - hy}px) scale(${s})`;
}

export function setTool(agent, tool) {
  if (agent.tool === tool) return;
  agent.tool = tool;
  agent.icon.innerHTML = cursorSvg(tool, agent.color);
  placeCursor(agent);
}

function setBox(agent, left, top, width, height) {
  const s = agent.box.style;
  s.transform = `translate(${left}px, ${top}px)`;
  s.width = `${width}px`;
  s.height = `${height}px`;
}

// 拖拽中：框从起点角到当前光标；以元素实时位置为准，页面滚动时起点跟着走
export function updateDragBox(agent) {
  const r = agent.boxLayer.node.getBoundingClientRect();
  const ax = r.left - BOX_PAD + (r.width + 2 * BOX_PAD) * agent.anchor.fx;
  const ay = r.top - BOX_PAD + (r.height + 2 * BOX_PAD) * agent.anchor.fy;
  const w = Math.abs(agent.x - ax);
  const h = Math.abs(agent.y - ay);
  setBox(agent, Math.min(ax, agent.x), Math.min(ay, agent.y), w, h);
  agent.sizeLabel.textContent = `${Math.round(Math.max(w - 2 * BOX_PAD, 0))} × ${Math.round(Math.max(h - 2 * BOX_PAD, 0))}`;
}

export function updateSelectBox(agent) {
  const r = agent.boxLayer.node.getBoundingClientRect();
  setBox(agent, r.left - BOX_PAD, r.top - BOX_PAD, r.width + 2 * BOX_PAD, r.height + 2 * BOX_PAD);
}

/** 当前选框在屏幕上的范围（用于标尺投影） */
export function boxScreenRect(agent) {
  const r = agent.boxLayer.node.getBoundingClientRect();
  if (agent.mode !== 'drag') return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  const ax = r.left + r.width * agent.anchor.fx;
  const ay = r.top + r.height * agent.anchor.fy;
  return { left: Math.min(ax, agent.x), top: Math.min(ay, agent.y), right: Math.max(ax, agent.x), bottom: Math.max(ay, agent.y) };
}

export function setBoxMode(agent, mode, kind) {
  agent.mode = mode;
  const s = agent.box.style;
  s.backgroundImage = 'none';
  if (mode === 'drag') s.backgroundColor = `${agent.color}14`;
  else if (mode === 'placeholder') s.cssText += PLACEHOLDER[kind] || PLACEHOLDER.block;
  else s.backgroundColor = 'transparent';
  agent.handles.forEach((h) => { h.style.opacity = mode === 'drag' ? '0' : '1'; });
  s.opacity = mode === 'idle' ? '0' : '1';
}

/** 在打字位置显示插入光标；x 为右端，top/h 为当前行 */
export function showCaret(agent, x, top, h) {
  const s = agent.caret.style;
  s.transform = `translate(${Math.round(x)}px, ${Math.round(top)}px)`;
  s.height = `${Math.max(10, Math.round(h))}px`;
  s.opacity = '1';
  s.animation = 'none';
  void agent.caret.offsetWidth;
  s.animation = 'ar-caret 1.06s steps(1) infinite';
}

export function hideCaret(agent) {
  agent.caret.style.animation = 'none';
  agent.caret.style.opacity = '0';
}

/** 光标旁的小标记，传 null 隐藏 */
export function setBadge(agent, text) {
  if (text) agent.badge.textContent = text;
  agent.badge.style.opacity = text ? '1' : '0';
}

export function showCursor(agent, on) {
  agent.cursor.style.opacity = on ? '1' : '0';
  agent.visible = on;
}
