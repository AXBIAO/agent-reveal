// 光标工具形态：箭头（移动）、十字准星（画框）、I 形（打字）、钢笔（画线）

const SHADOW = 'filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))';

// 热点偏移：图形的哪个点对准光标坐标
export const HOTSPOT = { arrow: [3, 2], cross: [11, 11], text: [11, 11], pen: [3, 20] };

export function cursorSvg(tool, color) {
  if (tool === 'cross') {
    return `<svg width="22" height="22" viewBox="0 0 22 22" style="${SHADOW}"><path d="M11 2v7M11 13v7M2 11h7M13 11h7" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><path d="M11 2v7M11 13v7M2 11h7M13 11h7" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/><circle cx="11" cy="11" r="1.4" fill="${color}"/></svg>`;
  }
  if (tool === 'pen') {
    // 钢笔尖朝左下，笔尖为热点
    return `<svg width="22" height="22" viewBox="0 0 22 22" style="${SHADOW}"><path d="M3 20l3.2-8.2L14 4l4 4-7.8 7.8z" fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8.6" cy="13.4" r="1.3" fill="#fff"/><path d="M3 20l3.4-3.4" stroke="#fff" stroke-width="1.2"/></svg>`;
  }
  if (tool === 'text') {
    return `<svg width="22" height="22" viewBox="0 0 22 22" style="${SHADOW}"><path d="M8 3h6M8 19h6M11 3v16" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><path d="M8 3h6M8 19h6M11 3v16" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  }
  return `<svg width="22" height="22" viewBox="0 0 24 24" style="${SHADOW}"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
