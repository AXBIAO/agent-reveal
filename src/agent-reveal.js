/*
 * Agent Reveal — 多 agent 光标"搭建"现成网页的演示动画
 * 用法：作为书签运行，或在控制台粘贴。Esc 中止并还原。
 * 可在运行前设置 window.AGENT_REVEAL_CONFIG 覆盖下方默认参数。
 * 由 scripts/build.mjs 用 esbuild 打包成单文件 IIFE。
 */
import { buildTypingScript } from './typing.js';
import { canRecord, startRecording, stopRecording, discardRecording, showSavedPanel } from './recorder.js';

(function () {
  'use strict';

  const DEFAULTS = {
    maxAgents: 26,          // 同时在场的光标上限
    startAgents: 3,         // 开场光标数
    rampRatio: 0.2,         // 前 20% 时长内从 startAgents 增长到 maxAgents
    durationMs: 30000,      // 用于计算 agent 增长节奏（实际总时长受页面长度影响）
    speed: 0.7,             // 动作快慢系数，越小越快
    maxLayers: 700,         // 图层上限（超过时合并为更粗粒度）
    scrollAnchor: 0.38,     // 施工前沿保持在视口 38% 高度处
    showNames: false,       // 光标旁显示 agent 名字
    record: true,           // 自动录制当前标签页，完整跑完后下载并弹出保存位置
    onDone: null,           // 钩子：跑完、还原页面前调用并等待（扩展用来停止录屏）
    onAbort: null,          // 钩子：Esc/✕ 中途退出时调用
    colors: ['#ff4d4f', '#2f7bff', '#16b364', '#f79009', '#9e77ed', '#ee46bc',
      '#06aed4', '#e9b500', '#ff692e', '#4e5ba6', '#12b76a', '#d444f1'],
  };
  const CFG = Object.freeze({ ...DEFAULTS, ...(window.AGENT_REVEAL_CONFIG || {}) });

  const Z = 2147483647;
  const BOX_PAD = 3;     // 选框比元素外扩的像素
  const FRAME_MS = 28;   // 打字刷新间隔
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'BR', 'WBR']);
  const MEDIA_TAGS = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'PICTURE', 'IFRAME']);
  const ATOMIC_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT']);

  if (window.__agentReveal) window.__agentReveal.stop();

  // ---------- 工具 ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const sleep = (ms, run) => new Promise((res) => {
    const id = setTimeout(res, ms);
    run.timers.add(id);
  });
  const el = (tag, css, html) => {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (html) n.innerHTML = html;
    return n;
  };

  // ---------- 图层收集 ----------
  // 站点常开 scroll-behavior:smooth，逐帧 scrollTo 会互相打断，必须用 instant
  const scrollToY = (y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' });

  function isRendered(node, style) {
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = node.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }

  // opacity:0 的节点（常见于"滚动出现"区块）自身不当图层，但仍收集其子元素
  const isTransparent = (style) => parseFloat(style.opacity) === 0;

  function hasOwnText(node) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3 && c.nodeValue.trim()) return true;
    }
    return false;
  }

  function isBlock(style, rect) {
    if (rect.width < 24 || rect.height < 24) return false;
    const bg = style.backgroundColor;
    const hasBg = bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg);
    const hasImg = style.backgroundImage && style.backgroundImage !== 'none';
    const hasBorder = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none';
    const hasShadow = style.boxShadow && style.boxShadow !== 'none';
    return hasBg || hasImg || hasBorder || hasShadow;
  }

  function classify(node, style, rect) {
    if (MEDIA_TAGS.has(node.tagName.toUpperCase())) return 'media';
    if (ATOMIC_TAGS.has(node.tagName)) return 'control';
    if (hasOwnText(node)) return 'text';
    if (isBlock(style, rect)) return 'block';
    return null;
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
      const kind = node === document.body || isTransparent(style) ? null : classify(node, style, rect);
      if (kind) {
        layers.push({ node, kind, depth, fixed, top: rect.top + window.scrollY });
        if (kind === 'media' || kind === 'control') return;
        if (opts.coarse && kind === 'block' && depth >= opts.coarseDepth) return;
      }
      for (const c of node.children) walk(c, depth + 1, fixed);
    };
    walk(root, 0, false);
    return layers;
  }

  function buildLayers(overlay) {
    let layers = collectLayers(document.body, overlay, { coarse: false });
    // 太多时逐级加粗粒度：深层 block 作为整体出现
    for (let d = 12; layers.length > CFG.maxLayers && d >= 3; d -= 1) {
      layers = collectLayers(document.body, overlay, { coarse: true, coarseDepth: d });
    }
    const ordered = layers
      .map((l, i) => ({ ...l, index: i }))
      .sort((a, b) => (Math.round(a.top / 48) - Math.round(b.top / 48)) || (a.index - b.index));
    return ordered;
  }

  // ---------- 样式隐藏 / 还原 ----------
  const PROPS = ['opacity', 'transition', 'filter'];
  const probe = document.createElement('div');

  function snapshotStyle(node) {
    return {
      attr: node.getAttribute('style'),
      props: PROPS.map((p) => [p, node.style.getPropertyValue(p), node.style.getPropertyPriority(p)]),
    };
  }

  // 只撤掉脚本动过的属性；若剩余样式与原始语义一致，再写回原始字符串做到字节级还原。
  // 页面自己在动画期间改过的内联样式（如滑块 clip-path）会被保留。
  function restoreStyle(node, snap) {
    for (const [p, v, pri] of snap.props) {
      if (v) node.style.setProperty(p, v, pri);
      else node.style.removeProperty(p);
    }
    probe.setAttribute('style', snap.attr || '');
    if (probe.style.cssText !== node.style.cssText) return;
    if (snap.attr === null) node.removeAttribute('style');
    else node.setAttribute('style', snap.attr);
  }

  function hide(layer) {
    layer.snap = snapshotStyle(layer.node);
    layer.node.style.setProperty('transition', 'none', 'important');
    layer.node.style.setProperty('opacity', '0', 'important');
  }

  // ---------- 打字效果（字符数不变，布局不跳） ----------
  function wrapText(node) {
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

  function unwrapText(pieces) {
    for (const p of pieces) {
      if (p.wrap.isConnected) p.wrap.replaceWith(p.original);
    }
  }

  // ---------- 覆盖层 UI ----------
  const CURSOR_SVG = (color) => `<svg width="22" height="22" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

  function createOverlay() {
    const overlay = el('div', `position:fixed;inset:0;z-index:${Z};pointer-events:none;font:12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;`);
    overlay.setAttribute('data-agent-reveal', '');
    const bar = el('div', 'position:fixed;right:18px;bottom:18px;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:12px;background:rgba(24,24,27,.92);color:#e4e4e7;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:auto;backdrop-filter:blur(8px);');
    bar.innerHTML = `
      <span data-k="dot" style="width:9px;height:9px;border-radius:50%;background:#2f7bff;box-shadow:0 0 8px #2f7bff"></span>
      <span><b data-k="agents" style="color:#fff">1</b> agents</span>
      <span style="opacity:.35">|</span>
      <span><b data-k="done" style="color:#fff">0</b> / <span data-k="total">0</span> layers</span>
      <span style="width:72px;height:4px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden"><span data-k="prog" style="display:block;height:100%;width:0;background:#2f7bff;transition:width .2s"></span></span>
      <span data-k="typing" style="padding:2px 7px;border-radius:6px;background:rgba(47,123,255,.22);color:#9ec1ff;opacity:0;transition:opacity .2s">Typing…</span>
      <span data-k="close" title="Esc 退出" style="cursor:pointer;opacity:.55;padding:0 2px">✕</span>`;
    overlay.appendChild(bar);
    const q = (k) => bar.querySelector(`[data-k="${k}"]`);
    return { overlay, bar, refs: { agents: q('agents'), done: q('done'), total: q('total'), prog: q('prog'), typing: q('typing'), close: q('close') } };
  }

  function createAgent(overlay, id) {
    const color = CFG.colors[id % CFG.colors.length];
    const cursor = el('div', 'position:fixed;left:0;top:0;will-change:transform;transition:opacity .3s;opacity:0;');
    cursor.innerHTML = CURSOR_SVG(color) + (CFG.showNames
      ? `<span style="position:absolute;left:16px;top:18px;padding:1px 6px;border-radius:5px;background:${color};color:#fff;white-space:nowrap">Agent ${id + 1}</span>`
      : '');
    const box = el('div', `position:fixed;left:0;top:0;border:1.5px solid ${color};border-radius:2px;opacity:0;transition:opacity .18s,background-color .18s;box-sizing:border-box;`);
    const handle = `position:absolute;width:6px;height:6px;background:#fff;border:1.5px solid ${color};box-sizing:border-box;transition:opacity .15s;`;
    box.innerHTML = `
      <i data-h style="${handle}left:-4px;top:-4px"></i><i data-h style="${handle}right:-4px;top:-4px"></i>
      <i data-h style="${handle}left:-4px;bottom:-4px"></i><i data-h style="${handle}right:-4px;bottom:-4px"></i>
      <span data-k="size" style="position:absolute;left:50%;top:100%;transform:translate(-50%,6px);padding:1px 5px;border-radius:3px;background:${color};color:#fff;font-size:10px;white-space:nowrap"></span>`;
    overlay.append(box, cursor);
    const edge = Math.floor(Math.random() * 4);
    const x = edge === 1 ? innerWidth + 20 : edge === 3 ? -20 : rand(0, innerWidth);
    const y = edge === 0 ? -20 : edge === 2 ? innerHeight + 20 : rand(0, innerHeight);
    return {
      id, color, cursor, box, x, y,
      sizeLabel: box.querySelector('[data-k="size"]'),
      handles: [...box.querySelectorAll('[data-h]')],
      mode: 'idle',   // idle | drag | select
      boxLayer: null,
      anchor: null,   // 拖拽起点（元素上的相对角）
    };
  }

  function placeCursor(agent) {
    const s = agent.pressed ? 0.86 : 1;
    agent.cursor.style.transform = `translate(${agent.x - 3}px, ${agent.y - 2}px) scale(${s})`;
  }

  function setBox(agent, left, top, width, height) {
    const s = agent.box.style;
    s.transform = `translate(${left}px, ${top}px)`;
    s.width = `${width}px`;
    s.height = `${height}px`;
  }

  // 拖拽中：框从起点角到当前光标；以元素实时位置为准，页面滚动时起点跟着走
  function updateDragBox(agent) {
    const r = agent.boxLayer.node.getBoundingClientRect();
    const ax = r.left - BOX_PAD + (r.width + 2 * BOX_PAD) * agent.anchor.fx;
    const ay = r.top - BOX_PAD + (r.height + 2 * BOX_PAD) * agent.anchor.fy;
    const w = Math.abs(agent.x - ax);
    const h = Math.abs(agent.y - ay);
    setBox(agent, Math.min(ax, agent.x), Math.min(ay, agent.y), w, h);
    agent.sizeLabel.textContent = `${Math.round(Math.max(w - 2 * BOX_PAD, 0))} × ${Math.round(Math.max(h - 2 * BOX_PAD, 0))}`;
  }

  function updateSelectBox(agent) {
    const r = agent.boxLayer.node.getBoundingClientRect();
    setBox(agent, r.left - BOX_PAD, r.top - BOX_PAD, r.width + 2 * BOX_PAD, r.height + 2 * BOX_PAD);
  }

  function setBoxMode(agent, mode) {
    agent.mode = mode;
    const dragging = mode === 'drag';
    agent.box.style.backgroundColor = dragging ? `${agent.color}14` : 'transparent';
    agent.handles.forEach((h) => { h.style.opacity = dragging ? '0' : '1'; });
    agent.box.style.opacity = mode === 'idle' ? '0' : '1';
  }

  function showCursor(agent, on) {
    agent.cursor.style.opacity = on ? '1' : '0';
    agent.visible = on;
  }

  // ---------- 主流程 ----------
  const run = {
    stopped: false,
    timers: new Set(),
    raf: 0,
    layers: [],
    pieces: [],
    agents: [],
    active: new Set(),
    queue: [],
    typing: 0,
    typos: 0,
    done: 0,
    recording: null,
    scrollY: 0,
  };

  function moveTo(agent, getPoint, ms, bendMax = 0.18) {
    return new Promise((resolve) => {
      const sx = agent.x;
      const sy = agent.y;
      const bend = rand(-bendMax, bendMax);
      const t0 = performance.now();
      const step = (now) => {
        if (run.stopped) return resolve();
        const t = clamp((now - t0) / ms, 0, 1);
        const e = easeInOut(t);
        const p = getPoint();
        const dx = p.x - sx;
        const dy = p.y - sy;
        // 弧线轨迹：垂直方向加一点偏移，更像真人
        const arc = Math.sin(Math.PI * e) * bend;
        agent.x = sx + dx * e - dy * arc;
        agent.y = sy + dy * e + dx * arc;
        placeCursor(agent);
        if (agent.mode === 'drag') updateDragBox(agent);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // 当前打字位置：已显示文字最后一行的右端
  function caretPoint(pieces, fallback) {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const rects = pieces[i].shown.getClientRects();
      if (rects.length) {
        const r = rects[rects.length - 1];
        return { x: r.right + 2, y: r.top + r.height * 0.55 };
      }
    }
    const r = fallback.getBoundingClientRect();
    return { x: r.left + 2, y: r.top + Math.min(r.height, 24) * 0.55 };
  }

  const isHeading = (node) => /^H[1-3]$/.test(node.tagName)
    || parseFloat(getComputedStyle(node).fontSize) >= 24;

  // 真人打字：逐字打出，标题会打错（重复字/颠倒/错字）再退格改对；光标跟着打字位置
  async function typeLayer(agent, layer, speed) {
    const pieces = wrapText(layer.node);
    run.pieces.push(...pieces);
    const heading = isHeading(layer.node);
    for (const p of pieces) {
      p.chars = Array.from(p.text);
      p.shown.textContent = '';
    }
    layer.node.style.setProperty('opacity', '1', 'important');
    run.typing += 1;
    for (const p of pieces) {
      const { frames, typos } = buildTypingScript(p.text, heading);
      run.typos += typos;
      for (const f of frames) {
        if (run.stopped) return;
        p.shown.textContent = f.shown;
        p.rest.textContent = p.chars.slice(f.restFrom).join('');
        const c = caretPoint(pieces, layer.node);
        agent.x += (c.x - agent.x) * 0.5;
        agent.y += (c.y - agent.y) * 0.5;
        placeCursor(agent);
        await sleep(Math.max(FRAME_MS, f.delay * speed), run);
      }
    }
    run.typing -= 1;
    unwrapText(pieces);
  }

  // 块/图片在框内淡入，光标移到中间做一次"放下"
  async function fadeLayer(agent, layer, ms) {
    const s = layer.node.style;
    s.setProperty('filter', 'blur(6px)', 'important');
    s.setProperty('transition', `opacity ${ms}ms ease, filter ${ms}ms ease`, 'important');
    void layer.node.offsetWidth;
    s.setProperty('opacity', '1', 'important');
    s.setProperty('filter', 'blur(0px)', 'important');
    const drop = { fx: rand(0.4, 0.6), fy: rand(0.4, 0.6) };
    await moveTo(agent, () => {
      const r = layer.node.getBoundingClientRect();
      return { x: r.left + r.width * drop.fx, y: r.top + Math.min(r.height * drop.fy, innerHeight * 0.6) };
    }, ms * 0.6);
    await press(agent, ms * 0.25);
    await sleep(ms * 0.15, run);
  }

  async function press(agent, ms) {
    agent.pressed = true;
    placeCursor(agent);
    await sleep(ms, run);
    agent.pressed = false;
    placeCursor(agent);
  }

  // 元素上的相对角点（含外扩 BOX_PAD），实时计算
  function cornerOf(layer, fx, fy) {
    return () => {
      const r = layer.node.getBoundingClientRect();
      return { x: r.left - BOX_PAD + (r.width + 2 * BOX_PAD) * fx, y: r.top - BOX_PAD + (r.height + 2 * BOX_PAD) * fy };
    };
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  async function work(agent, layer, speed) {
    run.active.add(layer);
    agent.boxLayer = layer;
    // 随机选一个角起拖，拖到对角，更像真人框选
    const fx = Math.random() < 0.7 ? 0 : 1;
    const fy = Math.random() < 0.75 ? 0 : 1;
    agent.anchor = { fx, fy };
    const start = cornerOf(layer, fx, fy);
    const end = cornerOf(layer, 1 - fx, 1 - fy);

    showCursor(agent, true);
    const approach = clamp(dist(agent, start()) * 0.9, 220, 800) * speed;
    await moveTo(agent, start, approach, 0.18);
    if (run.stopped) return;

    // 按下 → 拖拽拉框
    agent.pressed = true;
    placeCursor(agent);
    setBoxMode(agent, 'drag');
    updateDragBox(agent);
    const dragMs = clamp(dist(start(), end()) * 1.1, 260, 950) * speed;
    await moveTo(agent, end, dragMs, 0.04);
    if (run.stopped) return;

    // 松手 → 框吸附到元素，显示控制点，内容出现
    agent.pressed = false;
    placeCursor(agent);
    setBoxMode(agent, 'select');
    const r = layer.node.getBoundingClientRect();
    agent.sizeLabel.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    await sleep(120 * speed, run);

    if (layer.kind === 'text') await typeLayer(agent, layer, speed);
    else await fadeLayer(agent, layer, 520 * speed);
    if (run.stopped) return;

    setBoxMode(agent, 'idle');
    agent.boxLayer = null;
    restoreStyle(layer.node, layer.snap);
    layer.revealed = true;
    run.active.delete(layer);
    run.done += 1;
  }

  function targetAgents(elapsed) {
    const ramp = CFG.durationMs * CFG.rampRatio;
    const k = clamp(elapsed / ramp, 0, 1);
    return Math.round(CFG.startAgents + (CFG.maxAgents - CFG.startAgents) * k * k);
  }

  function tick(ui) {
    if (run.stopped) return;
    // 选框跟随滚动
    for (const a of run.agents) {
      if (a.mode === 'drag') updateDragBox(a);
      else if (a.mode === 'select') updateSelectBox(a);
    }
    // 自动滚动：施工前沿（在建图层与队首中最靠上的一个）保持在视口锚点
    // 用实时位置：图片懒加载等会让页面高度在运行中变化
    const liveTop = (l) => l.node.getBoundingClientRect().top + window.scrollY;
    let frontier = Infinity;
    for (const l of run.active) if (!l.fixed) frontier = Math.min(frontier, liveTop(l));
    const head = run.queue.find((l) => !l.fixed);
    if (head) frontier = Math.min(frontier, liveTop(head));
    if (frontier !== Infinity) {
      const maxY = document.documentElement.scrollHeight - innerHeight;
      const want = clamp(frontier - innerHeight * CFG.scrollAnchor, 0, maxY);
      if (want > run.scrollY) {
        run.scrollY += Math.max((want - run.scrollY) * 0.06, Math.min(1.5, want - run.scrollY));
        scrollToY(run.scrollY);
      }
    }
    ui.refs.agents.textContent = String(Math.max(run.agents.filter((a) => a.busy).length, 1));
    ui.refs.done.textContent = String(run.done);
    ui.refs.prog.style.width = `${(run.done / run.layers.length) * 100}%`;
    ui.refs.typing.style.opacity = run.typing > 0 ? '1' : '0';
    run.raf = requestAnimationFrame(() => tick(ui));
  }

  // 队首图层已进入视口（或是固定元素）才允许领取，保证光标都在镜头里
  // 兜底：已滚到底或等待超时（如藏在屏幕外的面板永远进不了视口）也直接领取，避免死锁
  const HEAD_WAIT_MS = 1500;
  function headInView(queue) {
    const l = queue[0];
    if (run.waitingFor !== l) {
      run.waitingFor = l;
      run.waitSince = performance.now();
    }
    if (l.fixed) return true;
    if (l.node.getBoundingClientRect().top < innerHeight * 0.92) return true;
    const atBottom = window.scrollY >= document.documentElement.scrollHeight - innerHeight - 2;
    return atBottom || performance.now() - run.waitSince > HEAD_WAIT_MS;
  }

  // 没有可领的图层时光标淡出，不在画面上闲逛；有活再淡入飞过去
  async function agentLoop(agent, queue) {
    while (!run.stopped && queue.length) {
      if (!headInView(queue)) {
        agent.busy = false;
        showCursor(agent, false);
        await sleep(120, run);
        continue;
      }
      const layer = queue.shift();
      agent.busy = true;
      await work(agent, layer, CFG.speed * rand(0.8, 1.2));
    }
    agent.busy = false;
    showCursor(agent, false);
  }

  function cleanup(ui) {
    run.stopped = true;
    cancelAnimationFrame(run.raf);
    run.timers.forEach(clearTimeout);
    unwrapText(run.pieces);
    for (const l of run.layers) if (l.snap) restoreStyle(l.node, l.snap);
    window.removeEventListener('keydown', run.onKey, true);
    // 中途退出（Esc/✕）时丢弃录屏，并通知宿主
    if (run.recording) discardRecording(run.recording);
    if (!run.finished && typeof CFG.onAbort === 'function') CFG.onAbort();
    run.recording = null;
    ui.overlay.remove();
    delete window.__agentReveal;
  }

  // ---------- 录屏 ----------
  const PANEL_CSS = `position:fixed;z-index:${Z};font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;`;

  function toast(text) {
    const t = el('div', `${PANEL_CSS}left:50%;top:24px;transform:translateX(-50%);padding:9px 16px;border-radius:10px;background:rgba(24,24,27,.94);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);`);
    t.textContent = text;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // 没有用户激活（比如从控制台运行）时，先弹一个按钮让用户点一下
  function askToStart() {
    return new Promise((resolve) => {
      const p = el('div', `${PANEL_CSS}inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);`);
      p.innerHTML = `<div style="background:#18181b;color:#e4e4e7;border-radius:14px;padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,.4)">
        <div style="color:#fff;font-weight:600;margin-bottom:12px">Agent Reveal</div>
        <div style="display:flex;gap:10px">
          <button data-k="rec" style="padding:8px 14px;border-radius:9px;border:0;background:#2f7bff;color:#fff;cursor:pointer">● 录屏并播放</button>
          <button data-k="skip" style="padding:8px 14px;border-radius:9px;border:1px solid #3f3f46;background:#27272a;color:#fff;cursor:pointer">只播放</button>
        </div></div>`;
      document.documentElement.appendChild(p);
      const pick = (v) => () => { p.remove(); resolve(v); };
      p.querySelector('[data-k="rec"]').addEventListener('click', pick('record'));
      p.querySelector('[data-k="skip"]').addEventListener('click', pick('skip'));
    });
  }

  async function tryRecord() {
    try {
      return await startRecording();
    } catch (err) {
      if (err && err.name === 'InvalidStateError') throw err;
      toast(err && err.name === 'NotAllowedError' ? '已取消共享，本次不录屏' : `录屏启动失败：${err && err.message}`);
      return null;
    }
  }

  async function prepareRecording() {
    if (!CFG.record) return null;
    if (!canRecord()) {
      toast('当前浏览器不支持标签页录屏，本次只播放');
      return null;
    }
    try {
      return await tryRecord();
    } catch {
      const choice = await askToStart();
      if (choice !== 'record') return null;
      try { return await tryRecord(); } catch { return null; }
    }
  }

  async function finishRecording() {
    if (!run.recording) return;
    const r = run.recording;
    run.recording = null;
    try {
      const blob = await stopRecording(r);
      if (blob.size) showSavedPanel(blob, r.mime, Z);
      else toast('录屏为空，未保存');
    } catch (err) {
      console.error('[agent-reveal] 录屏保存失败', err);
      toast(`录屏保存失败：${err.message}`);
    }
  }

  async function start() {
    run.recording = await prepareRecording();
    // Chrome 开始共享时顶部会出现提示条，等视口稳定后再收集图层
    if (run.recording) await new Promise((r) => setTimeout(r, 800));
    const ui = createOverlay();
    document.documentElement.appendChild(ui.overlay);
    scrollToY(0);
    run.layers = buildLayers(ui.overlay);
    if (!run.layers.length) {
      cleanup(ui);
      alert('Agent Reveal：页面上没有找到可动画的元素。');
      return;
    }
    run.layers.forEach(hide);
    ui.refs.total.textContent = String(run.layers.length);

    run.onKey = (e) => { if (e.key === 'Escape') cleanup(ui); };
    window.addEventListener('keydown', run.onKey, true);
    ui.refs.close.addEventListener('click', () => cleanup(ui));
    window.__agentReveal = { stop: () => cleanup(ui), state: run };

    const queue = [...run.layers];
    run.queue = queue;
    const t0 = performance.now();
    const loops = [];
    run.raf = requestAnimationFrame(() => tick(ui));

    while (!run.stopped && queue.length) {
      const want = targetAgents(performance.now() - t0);
      while (run.agents.length < want) {
        const agent = createAgent(ui.overlay, run.agents.length);
        run.agents.push(agent);
        loops.push(agentLoop(agent, queue));
      }
      await sleep(200, run);
    }
    await Promise.all(loops);
    if (run.stopped) return;
    ui.refs.done.textContent = String(run.layers.length);
    ui.refs.prog.style.width = '100%';
    ui.refs.typing.textContent = 'Done';
    ui.refs.typing.style.opacity = '1';
    await sleep(2200, run);
    if (run.stopped) return;
    // 先停录（保留 Done 画面），再还原页面，最后弹出保存位置
    run.finished = true;
    if (typeof CFG.onDone === 'function') await CFG.onDone();
    const recording = finishRecording();
    cleanup(ui);
    await recording;
  }

  start().catch((err) => {
    console.error('[agent-reveal]', err);
    if (window.__agentReveal) window.__agentReveal.stop();
  });
})();
