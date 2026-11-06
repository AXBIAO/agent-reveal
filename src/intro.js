// 开场：页面元素自上而下溶解成白板，同时一道扫描光带扫过视口

const SCAN_MS = 1100;

/**
 * 计算每个图层的溶解延迟：视口内按纵向位置错开，视口外立即隐藏（纯函数）
 * @param {number} top 元素顶部（屏幕坐标）
 * @param {number} vh 视口高
 * @returns {number|null} 毫秒；null 表示不需要动画（不在视口内）
 */
export function dissolveDelay(top, vh, total = SCAN_MS) {
  if (top > vh || top < -vh) return null;
  return Math.round(Math.max(0, Math.min(1, top / vh)) * total * 0.85);
}

export function scanBeam(overlay) {
  const beam = document.createElement('div');
  beam.style.cssText = 'position:fixed;left:0;right:0;top:0;height:120px;pointer-events:none;'
    + 'background:linear-gradient(to bottom, rgba(47,123,255,0) 0%, rgba(47,123,255,.10) 70%, rgba(47,123,255,.55) 98%, rgba(255,255,255,.9) 100%);'
    + `transform:translateY(-120px);transition:transform ${SCAN_MS}ms cubic-bezier(.45,.05,.4,1), opacity .35s;`;
  overlay.appendChild(beam);
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      beam.style.transform = `translateY(${innerHeight}px)`;
      setTimeout(() => {
        beam.style.opacity = '0';
        setTimeout(() => { beam.remove(); resolve(); }, 350);
      }, SCAN_MS);
    });
  });
}

export const INTRO_MS = SCAN_MS;
