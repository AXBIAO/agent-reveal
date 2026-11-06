// 图层：收集页面里要被"搭建"的元素、隐藏与字节级还原内联样式、打字用的文本包裹

import { penSide } from './repeats.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'BR', 'WBR']);
const MEDIA_TAGS = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'PICTURE', 'IFRAME']);
const ATOMIC_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT']);
const SIDES = ['top', 'right', 'bottom', 'left'];

export const pageRect = (node) => {
  const r = node.getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
};

// 细分隔线（1–3px）也要收集，用钢笔画出来
function isRendered(node, style) {
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const r = node.getBoundingClientRect();
  return (r.width >= 4 && r.height >= 4) || (r.width >= 24 && r.height >= 1) || (r.height >= 24 && r.width >= 1);
}

// opacity:0 的节点（常见于"滚动出现"区块）自身不当图层，但仍收集其子元素
const isTransparent = (style) => parseFloat(style.opacity) === 0;

function hasOwnText(node) {
  for (const c of node.childNodes) {
    if (c.nodeType === 3 && c.nodeValue.trim()) return true;
  }
  return false;
}

const visibleColor = (c) => c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c);

function decoration(node, style, rect) {
  const borders = {};
  for (const s of SIDES) {
    const v = (p) => style.getPropertyValue(`border-${s}-${p}`);
    borders[s] = parseFloat(v('width')) > 0 && v('style') !== 'none' && visibleColor(v('color'));
  }
  return {
    tag: node.tagName.toUpperCase(),
    w: rect.width,
    h: rect.height,
    borders,
    hasBg: visibleColor(style.backgroundColor),
    hasImg: Boolean(style.backgroundImage && style.backgroundImage !== 'none'),
    hasShadow: Boolean(style.boxShadow && style.boxShadow !== 'none'),
  };
}

function classify(node, style, rect) {
  const tag = node.tagName.toUpperCase();
  if (MEDIA_TAGS.has(tag)) return { kind: 'media' };
  if (ATOMIC_TAGS.has(node.tagName)) return { kind: 'control' };
  if (hasOwnText(node)) return { kind: 'text' };
  const d = decoration(node, style, rect);
  const line = penSide(d);
  if (line) return { kind: 'block', line };
  if (rect.width < 24 || rect.height < 24) return null;
  const hasBorder = Object.values(d.borders).some(Boolean);
  return d.hasBg || d.hasImg || hasBorder || d.hasShadow ? { kind: 'block' } : null;
}

function collectLayers(root, overlay, opts) {
  const layers = [];
  // inFixed：祖先是 fixed/sticky 时，子元素同样随视口走，不参与滚动前沿计算
  const walk = (node, depth, inFixed) => {
    if (node === overlay || SKIP_TAGS.has(node.tagName)) return;
    const style = getComputedStyle(node);
    if (!isRendered(node, style)) return;
    const rect = node.getBoundingClientRect();
    const fixed = inFixed || style.position === 'fixed' || style.position === 'sticky';
    const c = node === document.body || isTransparent(style) ? null : classify(node, style, rect);
    if (c) {
      layers.push({
        node, kind: c.kind, line: c.line || null, depth, fixed,
        top: rect.top + scrollY,
        box: { x: rect.left + scrollX, y: rect.top + scrollY, w: rect.width, h: rect.height },
      });
      if (c.kind === 'media' || c.kind === 'control') return;
      if (opts.coarse && c.kind === 'block' && depth >= opts.coarseDepth) return;
    }
    for (const child of node.children) walk(child, depth + 1, fixed);
  };
  walk(root, 0, false);
  return layers;
}

/** 收集并按从上到下排序；太多时逐级加粗粒度（深层 block 作为整体出现） */
export function buildLayers(overlay, maxLayers) {
  let layers = collectLayers(document.body, overlay, { coarse: false });
  for (let d = 12; layers.length > maxLayers && d >= 3; d -= 1) {
    layers = collectLayers(document.body, overlay, { coarse: true, coarseDepth: d });
  }
  return layers
    .map((l, i) => ({ ...l, index: i }))
    .sort((a, b) => (Math.round(a.top / 48) - Math.round(b.top / 48)) || (a.index - b.index))
    .map((l, order) => ({ ...l, order }));
}

// ---------- 样式隐藏 / 还原 ----------
const PROPS = ['opacity', 'transition', 'filter', 'clip-path', 'transform', 'transform-origin'];
const probe = document.createElement('div');

function snapshotStyle(node) {
  return {
    attr: node.getAttribute('style'),
    props: PROPS.map((p) => [p, node.style.getPropertyValue(p), node.style.getPropertyPriority(p)]),
  };
}

// 只撤掉脚本动过的属性；若剩余样式与原始语义一致，再写回原始字符串做到字节级还原。
// 页面自己在动画期间改过的内联样式（如滑块 clip-path）会被保留。
export function restoreStyle(node, snap) {
  for (const [p, v, pri] of snap.props) {
    if (v) node.style.setProperty(p, v, pri);
    else node.style.removeProperty(p);
  }
  probe.setAttribute('style', snap.attr || '');
  if (probe.style.cssText !== node.style.cssText) return;
  if (snap.attr === null) node.removeAttribute('style');
  else node.setAttribute('style', snap.attr);
}

// delayMs 为数字时：视口内元素按位置错开溶解（开场效果）；否则立即隐藏
export function hide(layer, delayMs) {
  layer.snap = snapshotStyle(layer.node);
  const transition = typeof delayMs === 'number' ? `opacity 380ms ease ${delayMs}ms` : 'none';
  layer.node.style.setProperty('transition', transition, 'important');
  layer.node.style.setProperty('opacity', '0', 'important');
}

// ---------- 打字效果（字符数不变，布局不跳） ----------
export function wrapText(node) {
  const pieces = [];
  for (const c of [...node.childNodes]) {
    if (c.nodeType !== 3 || !c.nodeValue.trim()) continue;
    const wrap = document.createElement('span');
    const shown = document.createElement('span');
    const rest = document.createElement('span');
    rest.style.opacity = '0';
    rest.textContent = c.nodeValue;
    wrap.append(shown, rest);
    c.replaceWith(wrap);
    pieces.push({ original: c, wrap, shown, rest, text: c.nodeValue });
  }
  return pieces;
}

export function unwrapText(pieces) {
  for (const p of pieces) {
    if (p.wrap.isConnected) p.wrap.replaceWith(p.original);
  }
}
