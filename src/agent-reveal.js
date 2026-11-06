/*
 * Agent Reveal — 多 agent 光标"搭建"现成网页的演示动画
 * 用法：作为书签运行，或在控制台粘贴。Esc 中止并还原。
 * 可在运行前设置 window.AGENT_REVEAL_CONFIG 覆盖下方默认参数。
 * 由 scripts/build.mjs 用 esbuild 打包成单文件 IIFE。
 */
import { buildTypingScript } from './typing.js';
import { durationScale } from './pace.js';
import { canRecord, startRecording, stopRecording, discardRecording, showSavedPanel } from './recorder.js';
import { SoundEngine, createSfx } from './sound.js';
import { createRulers, RULER } from './rulers.js';
import { computeGuides } from './guides.js';
import { nearestGap } from './redline.js';
import { createDesignLayer } from './design-layer.js';
import { scanBeam, dissolveDelay, INTRO_MS } from './intro.js';
import { createHud } from './hud.js';
import { buildLayers, pageRect, restoreStyle, hide, wrapText, unwrapText } from './layers.js';
import { findRepeatGroups, lineEnds } from './repeats.js';
import {
  BOX_PAD, createAgent, placeCursor, setTool, updateDragBox, updateSelectBox,
  boxScreenRect, setBoxMode, showCursor, showCaret, hideCaret, setBadge,
} from './agent-ui.js';

(function () {
  'use strict';

  const DEFAULTS = {
    maxAgents: 26,          // 同时在场的光标上限
    startAgents: 3,         // 开场光标数
    rampRatio: 0.2,         // 前 20% 时长内从 startAgents 增长到 maxAgents
    durationMs: 30000,      // 用于计算 agent 增长节奏（实际总时长受页面长度影响）
    speed: 1,               // 动作速度，越大越快（0.5–2）
    maxLayers: 700,         // 图层上限（超过时合并为更粗粒度）
    scrollAnchor: 0.38,     // 施工前沿保持在视口 38% 高度处
    autoScroll: true,       // 自动向下滚动；关闭后只搭当前屏幕，用户滚到哪搭到哪
    showNames: false,       // 光标旁显示 agent 名字
    rulers: true,           // 标尺、参考线、间距红线
    duplicates: true,       // 重复组件用 ⌥ 拖拽复制（导航标签、卡片、列表行等）
    sound: true,            // 鼠标、键盘、放置音效
    intro: true,            // 开场溶解 + 扫描
    record: true,           // 自动录制当前标签页，完整跑完后下载并弹出保存位置
    sfx: null,              // 宿主提供的音效通道 (name, args) => void（扩展转发到离屏文档）
    onDone: null,           // 钩子：跑完、还原页面前调用并等待（扩展用来停止录屏）
    onAbort: null,          // 钩子：Esc/✕ 中途退出时调用
    colors: ['#ff4d4f', '#2f7bff', '#16b364', '#f79009', '#9e77ed', '#ee46bc',
      '#06aed4', '#e9b500', '#ff692e', '#4e5ba6', '#12b76a', '#d444f1'],
  };
  const CFG = Object.freeze({ ...DEFAULTS, ...(window.AGENT_REVEAL_CONFIG || {}) });

  const Z = 2147483647;
  const FRAME_MS = 28;      // 打字刷新间隔
  const MAX_PLACED = 400;   // 计算间距红线时参考的已完成元素数

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
  // 站点常开 scroll-behavior:smooth，逐帧 scrollTo 会互相打断，必须用 instant
  const scrollToY = (y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  // ---------- 主流程状态 ----------
  const run = {
    stopped: false,
    finished: false,
    timers: new Set(),
    raf: 0,
    layers: [],
    pieces: [],
    agents: [],
    active: new Set(),
    queue: [],
    guideTasks: [],
    placed: [],
    typing: 0,
    typos: 0,
    done: 0,
    recording: null,
    engine: null,
    scrollY: 0,
  };
  let sfx = createSfx(() => {});
  let design = null;
  let rulers = null;
  const xn = (agent) => clamp(agent.x / Math.max(1, innerWidth), 0, 1);

  /** onStep：每帧回调（拉参考线时让线跟着光标走） */
  function moveTo(agent, getPoint, ms, bendMax = 0.18, onStep = null) {
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
        if (onStep) onStep(agent);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // 当前打字位置：已显示文字最后一行的右端（含行高，用于插入光标）
  function caretPoint(pieces, fallback) {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const rects = pieces[i].shown.getClientRects();
      if (rects.length) {
        const r = rects[rects.length - 1];
        return { x: r.right + 2, y: r.top + r.height * 0.55, top: r.top, h: r.height };
      }
    }
    const r = fallback.getBoundingClientRect();
    const h = Math.min(r.height, 24);
    return { x: r.left + 2, y: r.top + h * 0.55, top: r.top, h };
  }

  const isHeading = (node) => /^H[1-3]$/.test(node.tagName)
    || parseFloat(getComputedStyle(node).fontSize) >= 24;

  // 大标题逐级放大：先缩到相当于 GROW_FROM_PX 的大小，随进度分 GROW_STEPS 级放回原尺寸。
  // 用 transform 不改真实字号，排版不跳；页面本身用了 transform 的标题不做
  const GROW_MIN_PX = 28;
  const GROW_FROM_PX = 18;
  const GROW_STEPS = 4;
  function setupGrow(node) {
    const st = getComputedStyle(node);
    const fs = parseFloat(st.fontSize);
    if (!(fs >= GROW_MIN_PX) || st.transform !== 'none' || st.display === 'inline') return null;
    const from = GROW_FROM_PX / fs;
    const rtl = st.direction === 'rtl';
    node.style.setProperty('transform-origin', rtl ? 'right top' : 'left top', 'important');
    const apply = (step) => node.style.setProperty('transform', `scale(${from + ((1 - from) * step) / GROW_STEPS})`, 'important');
    apply(0);
    return { step: 0, apply };
  }

  // 真人打字：逐字打出，标题会打错再退格改对；I 形光标与插入光标跟着打字位置，带键盘声
  async function typeLayer(agent, layer, pace) {
    const pieces = wrapText(layer.node);
    run.pieces.push(...pieces);
    const heading = isHeading(layer.node);
    for (const p of pieces) {
      p.chars = Array.from(p.text);
      p.shown.textContent = '';
    }
    const total = Math.max(1, pieces.reduce((n, p) => n + p.chars.length, 0));
    let typedBefore = 0;
    layer.node.style.setProperty('transition', 'none', 'important');
    layer.node.style.setProperty('opacity', '1', 'important');
    const grow = heading ? setupGrow(layer.node) : null;
    setTool(agent, 'text');
    run.typing += 1;
    for (const p of pieces) {
      const { frames, typos } = buildTypingScript(p.text, heading);
      run.typos += typos;
      let prevLen = 0;
      for (const f of frames) {
        if (run.stopped) return;
        p.shown.textContent = f.shown;
        p.rest.textContent = p.chars.slice(f.restFrom).join('');
        const len = f.shown.length;
        if (len > prevLen) sfx.key(xn(agent), /\s$/.test(f.shown));
        else if (len < prevLen) sfx.backspace(xn(agent));
        prevLen = len;
        if (grow) {
          const step = Math.min(GROW_STEPS, Math.floor(((typedBefore + f.restFrom) / total) * GROW_STEPS));
          if (step > grow.step) {
            grow.step = step;
            grow.apply(step);
            sfx.grow(xn(agent), step);
          }
        }
        const c = caretPoint(pieces, layer.node);
        showCaret(agent, c.x, c.top, c.h);
        agent.x += (c.x + 6 - agent.x) * 0.5;
        agent.y += (c.y - agent.y) * 0.5;
        placeCursor(agent);
        await sleep(Math.max(FRAME_MS, f.delay * pace), run);
      }
      typedBefore += p.chars.length;
    }
    if (grow && grow.step < GROW_STEPS) grow.apply(GROW_STEPS);
    hideCaret(agent);
    run.typing -= 1;
    unwrapText(pieces);
  }
  // 图片从上往下扫出来；页面自己用了 clip-path 的元素（如对比滑块）不碰，改用模糊淡入
  function revealVisual(layer, ms) {
    const s = layer.node.style;
    const sweep = layer.kind === 'media' && getComputedStyle(layer.node).clipPath === 'none';
    if (sweep) {
      s.setProperty('clip-path', 'inset(0 0 100% 0)', 'important');
      s.setProperty('transition', 'none', 'important');
      s.setProperty('opacity', '1', 'important');
      void layer.node.offsetWidth;
      s.setProperty('transition', `clip-path ${ms * 1.2}ms cubic-bezier(.3,.7,.2,1)`, 'important');
      s.setProperty('clip-path', 'inset(0 0 0 0)', 'important');
      return;
    }
    s.setProperty('filter', 'blur(6px)', 'important');
    s.setProperty('transition', `opacity ${ms}ms ease, filter ${ms}ms ease`, 'important');
    void layer.node.offsetWidth;
    s.setProperty('opacity', '1', 'important');
    s.setProperty('filter', 'blur(0px)', 'important');
  }

  // 块/图片：线框占位 → 淡入真实内容，光标移到中间做一次"放下"
  async function fadeLayer(agent, layer, ms) {
    setBoxMode(agent, 'placeholder', layer.kind);
    await sleep(ms * 0.45, run);
    if (run.stopped) return;
    setBoxMode(agent, 'select');
    revealVisual(layer, ms);
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
    sfx.press(xn(agent));
    await sleep(ms, run);
    agent.pressed = false;
    placeCursor(agent);
    sfx.release(xn(agent));
  }

  // 元素上的相对角点（含外扩 BOX_PAD），实时计算
  function cornerOf(layer, fx, fy) {
    return () => {
      const r = layer.node.getBoundingClientRect();
      return { x: r.left - BOX_PAD + (r.width + 2 * BOX_PAD) * fx, y: r.top - BOX_PAD + (r.height + 2 * BOX_PAD) * fy };
    };
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // 放下后：量间距红线；所属参考线闪一下并发出吸附声
  function afterRelease(agent, layer) {
    if (!design || layer.fixed) return;
    const rect = pageRect(layer.node);
    design.redline(nearestGap(rect, run.placed));
    for (const task of layer.guides || []) {
      if (task.handle) {
        task.handle.flash();
        sfx.snap(xn(agent));
      }
    }
  }

  function finishLayer(layer) {
    restoreStyle(layer.node, layer.snap);
    layer.revealed = true;
    run.active.delete(layer);
    run.done += 1;
    if (!layer.fixed && layer.box.w >= 8) {
      run.placed = [...run.placed.slice(-MAX_PLACED + 1), pageRect(layer.node)];
    }
    for (const task of layer.guides || []) {
      task.remaining -= 1;
      if (task.remaining <= 0 && task.handle) {
        const h = task.handle;
        setTimeout(() => h.remove(), 600);
      }
    }
  }

  // pace：动作时长倍数（越小越快），由 durationScale(CFG.speed) 换算
  async function work(agent, layer, pace) {
    run.active.add(layer);
    agent.boxLayer = layer;
    // 随机选一个角起拖，拖到对角，更像真人框选
    const fx = Math.random() < 0.7 ? 0 : 1;
    const fy = Math.random() < 0.75 ? 0 : 1;
    agent.anchor = { fx, fy };
    const start = cornerOf(layer, fx, fy);
    const end = cornerOf(layer, 1 - fx, 1 - fy);

    showCursor(agent, true);
    setTool(agent, 'arrow');
    const approach = clamp(dist(agent, start()) * 0.9, 220, 800) * pace;
    await moveTo(agent, start, approach, 0.18);
    if (run.stopped) return;

    // 十字准星按下 → 拖拽拉框
    setTool(agent, 'cross');
    agent.pressed = true;
    placeCursor(agent);
    sfx.press(xn(agent));
    setBoxMode(agent, 'drag');
    updateDragBox(agent);
    const dragMs = clamp(dist(start(), end()) * 1.1, 260, 950) * pace;
    sfx.swish(xn(agent), dragMs / 1000);
    await moveTo(agent, end, dragMs, 0.04);
    if (run.stopped) return;

    // 松手 → 框吸附到元素，显示控制点、间距红线，内容出现
    agent.pressed = false;
    placeCursor(agent);
    sfx.release(xn(agent));
    setBoxMode(agent, 'select');
    const r = layer.node.getBoundingClientRect();
    agent.sizeLabel.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    afterRelease(agent, layer);
    await sleep(120 * pace, run);

    if (layer.kind === 'text') await typeLayer(agent, layer, pace);
    else {
      setTool(agent, 'arrow');
      await fadeLayer(agent, layer, 520 * pace);
    }
    if (run.stopped) return;

    const area = (r.width * r.height) / Math.max(1, innerWidth * innerHeight);
    sfx.place(layer.kind, xn(agent), area);
    setTool(agent, 'arrow');
    setBoxMode(agent, 'idle');
    agent.boxLayer = null;
    finishLayer(layer);
  }

  // 标尺按需滑入：有光标在拉参考线时出现，最后一条拉完 0.6 秒后收回（常驻会挡住网站内容）
  const RULER_HIDE_MS = 600;
  let rulerUsers = 0;
  let rulerTimer = 0;
  function rulersIn() {
    if (!rulers) return;
    rulerUsers += 1;
    clearTimeout(rulerTimer);
    rulers.show(true);
  }
  function rulersOut() {
    if (!rulers) return;
    rulerUsers = Math.max(0, rulerUsers - 1);
    if (rulerUsers) return;
    rulerTimer = setTimeout(() => rulers.show(false), RULER_HIDE_MS);
    run.timers.add(rulerTimer);
  }

  // ---------- 钢笔画线：起点锚点 → 橡皮筋跟着光标 → 终点锚点，线变实后真实分隔线出现 ----------
  async function penLayer(agent, layer, pace) {
    run.active.add(layer);
    const ends = () => lineEnds(layer.node.getBoundingClientRect(), layer.line);
    showCursor(agent, true);
    setTool(agent, 'pen');
    await moveTo(agent, () => ends().a, clamp(dist(agent, ends().a) * 0.9, 220, 800) * pace, 0.18);
    if (run.stopped) return;
    const pen = design ? design.pen(agent.color) : null;
    if (pen) pen.anchorA(ends().a);
    await press(agent, 70 * pace);
    const len = dist(ends().a, ends().b);
    const rubber = (a) => { if (pen) pen.rubber(ends().a, { x: a.x, y: a.y }); };
    await moveTo(agent, () => ends().b, clamp(len * 1.1, 260, 950) * pace, 0.01, rubber);
    if (run.stopped) return;
    if (pen) pen.anchorB(ends().a, ends().b);
    await press(agent, 70 * pace);
    sfx.snap(xn(agent));
    const s = layer.node.style;
    s.setProperty('transition', `opacity ${200 * pace}ms ease`, 'important');
    s.setProperty('opacity', '1', 'important');
    await sleep(260 * pace, run);
    if (pen) pen.remove();
    setTool(agent, 'arrow');
    finishLayer(layer);
  }

  // ---------- 复制组件：选中原件 → 按住 ⌥ 拖出副本 → 松手粘贴；副本里的文字之后再重新打 ----------
  async function dupLayer(agent, task, pace) {
    const { master, layer } = task;
    run.active.add(layer);
    const mRect = () => master.node.getBoundingClientRect();
    const dRect = () => layer.node.getBoundingClientRect();
    const grab = { fx: rand(0.3, 0.7), fy: rand(0.3, 0.7) };
    const grabOn = (r) => ({ x: r.left + r.width * grab.fx, y: r.top + Math.min(r.height * grab.fy, 160) });
    showCursor(agent, true);
    setTool(agent, 'arrow');
    await moveTo(agent, () => grabOn(mRect()), clamp(dist(agent, grabOn(mRect())) * 0.9, 220, 800) * pace, 0.18);
    if (run.stopped) return;

    // 选中原件
    agent.boxLayer = master;
    setBoxMode(agent, 'select');
    const m0 = mRect();
    agent.sizeLabel.textContent = `${Math.round(m0.width)} × ${Math.round(m0.height)}`;
    sfx.press(xn(agent));
    await sleep(160 * pace, run);
    if (run.stopped) return;

    // ⌥ 拖拽：副本框跟着光标走
    setBadge(agent, '⌥');
    agent.pressed = true;
    placeCursor(agent);
    setBoxMode(agent, 'idle');
    const ghost = design ? design.ghost(agent.color) : null;
    const follow = (a) => {
      const r = mRect();
      if (ghost) ghost.setRect(a.x - r.width * grab.fx, a.y - Math.min(r.height * grab.fy, 160), r.width, r.height);
    };
    follow(agent);
    sfx.swish(xn(agent), 0.4);
    const target = () => grabOn(dRect());
    await moveTo(agent, target, clamp(dist(agent, target()) * 0.9, 300, 900) * pace, 0.06, follow);
    if (run.stopped) return;

    // 松手粘贴：副本里的色块、图片立即出现，文字保持隐藏（之后由光标重新打）
    agent.pressed = false;
    placeCursor(agent);
    setBadge(agent, null);
    sfx.release(xn(agent));
    sfx.snap(xn(agent));
    if (ghost) ghost.remove();
    agent.boxLayer = layer;
    setBoxMode(agent, 'select');
    const r = dRect();
    agent.sizeLabel.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    if (design) design.redline(nearestGap(pageRect(layer.node), run.placed));
    for (const l of task.covers) {
      run.active.add(l);
      l.node.style.setProperty('transition', `opacity ${220 * pace}ms ease`, 'important');
      l.node.style.setProperty('opacity', '1', 'important');
    }
    sfx.place(layer.kind, xn(agent), (r.width * r.height) / Math.max(1, innerWidth * innerHeight));
    await sleep(320 * pace, run);
    if (run.stopped) return;
    setBoxMode(agent, 'idle');
    agent.boxLayer = null;
    for (const l of task.covers) finishLayer(l);
  }

  // ---------- 参考线任务：从标尺拉出一条线，停在对齐位置 ----------
  async function pullGuide(agent, task, pace) {
    const g = task.guide;
    const memberRect = () => task.node.getBoundingClientRect();
    const from = g.axis === 'x'
      ? () => ({ x: RULER / 2, y: clamp(memberRect().top + 12, RULER + 12, innerHeight - 60) })
      : () => ({ x: clamp(g.x - scrollX + 60, RULER + 12, innerWidth - 60), y: RULER / 2 });
    const to = g.axis === 'x'
      ? () => ({ x: g.pos - scrollX, y: from().y })
      : () => ({ x: from().x, y: g.pos - scrollY });
    showCursor(agent, true);
    setTool(agent, 'arrow');
    rulersIn();
    try {
      await dragGuide(agent, task, pace, from, to);
    } finally {
      rulersOut();
    }
  }

  async function dragGuide(agent, task, pace, from, to) {
    const g = task.guide;
    await moveTo(agent, from, clamp(dist(agent, from()) * 0.9, 220, 800) * pace, 0.18);
    if (run.stopped) return;
    agent.pressed = true;
    placeCursor(agent);
    sfx.press(xn(agent));
    sfx.guide(xn(agent));
    const handle = design.addGuide(g.axis);
    const follow = (a) => handle.setScreen(g.axis === 'x' ? a.x : a.y);
    await moveTo(agent, to, clamp(dist(from(), to()) * 0.9, 300, 900) * pace, 0.02, follow);
    if (run.stopped) return;
    handle.setPage(g.pos);
    agent.pressed = false;
    placeCursor(agent);
    sfx.release(xn(agent));
    sfx.snap(xn(agent));
    task.handle = handle;
    if (task.remaining <= 0) setTimeout(() => handle.remove(), 600);
    await sleep(160 * pace, run);
  }

  // 复制任务：重复组件里的复制品连同其中的色块/图片作为一个任务（⌥ 拖拽粘贴），其中的文字之后再重新打
  function buildDupTasks(flowing) {
    const parentIds = new Map();
    const parentKey = (node) => {
      const p = node.parentElement;
      if (!parentIds.has(p)) parentIds.set(p, parentIds.size + 1);
      return String(parentIds.get(p));
    };
    const className = (node) => (typeof node.className === 'string' ? node.className : (node.className && node.className.baseVal) || '');
    const groups = findRepeatGroups(flowing.filter((l) => !l.line).map((l) => ({
      id: l.order, parent: parentKey(l.node), tag: l.node.tagName, cls: className(l.node).trim(), w: l.box.w, h: l.box.h, order: l.order,
    })));
    const byOrder = new Map(flowing.map((l) => [l.order, l]));
    const tasks = new Map();
    const covered = new Set();
    for (const g of groups) {
      const master = byOrder.get(g.master);
      for (const id of g.copies) {
        const copy = byOrder.get(id);
        if (!master || !copy || covered.has(copy) || copy.node.contains(master.node)) continue;
        const covers = [copy, ...flowing.filter((l) => l !== copy && l.kind !== 'text' && !covered.has(l) && copy.node.contains(l.node))];
        covers.forEach((l) => covered.add(l));
        tasks.set(copy.order, { kind: 'dup', master, layer: copy, node: copy.node, fixed: false, top: copy.top, covers });
      }
    }
    return { tasks, covered };
  }

  // 队列：复制任务替换复制品；参考线任务插到它对齐的第一个元素之前
  function buildQueue(layers) {
    const flowing = layers.filter((l) => !l.fixed);
    const { tasks: dups, covered } = CFG.duplicates ? buildDupTasks(flowing) : { tasks: new Map(), covered: new Set() };
    run.dupTasks = [...dups.values()];
    const base = layers.flatMap((l) => {
      if (dups.has(l.order)) return [dups.get(l.order)];
      return covered.has(l) ? [] : [l];
    });
    if (!CFG.rulers) return base;
    const plain = flowing.filter((l) => !covered.has(l));
    const guides = computeGuides(plain.map((l) => ({ id: l.order, ...l.box })));
    const byOrder = new Map(layers.map((l) => [l.order, l]));
    const before = new Map();
    for (const g of guides) {
      const members = g.members.map((id) => byOrder.get(id)).filter(Boolean);
      if (!members.length) continue;
      const first = members.reduce((a, b) => (a.order < b.order ? a : b));
      const task = { kind: 'guide', guide: g, node: first.node, fixed: false, top: first.top - 1, remaining: members.length, handle: null };
      for (const m of members) m.guides = [...(m.guides || []), task];
      before.set(first.order, [...(before.get(first.order) || []), task]);
      run.guideTasks.push(task);
    }
    // 复制任务原样保留；普通图层前插入以它为首个成员的参考线任务（注意图层本身也有 kind 字段，不能用 kind 判断）
    return base.flatMap((t) => (t.kind === 'dup' ? [t] : [...(before.get(t.order) || []), t]));
  }
  function targetAgents(elapsed) {
    const ramp = CFG.durationMs * CFG.rampRatio;
    const k = clamp(elapsed / ramp, 0, 1);
    return Math.round(CFG.startAgents + (CFG.maxAgents - CFG.startAgents) * k * k);
  }

  function rulerBands() {
    const bands = [];
    for (const a of run.agents) {
      if (!a.boxLayer || a.mode === 'idle') continue;
      const r = boxScreenRect(a);
      bands.push({ axis: 'x', from: r.left, to: r.right, color: a.color });
      bands.push({ axis: 'y', from: r.top, to: r.bottom, color: a.color });
    }
    return bands;
  }

  function autoScroll() {
    // 施工前沿（在建图层与队首中最靠上的一个）保持在视口锚点；用实时位置（懒加载会改变页面高度）
    const liveTop = (l) => l.node.getBoundingClientRect().top + window.scrollY;
    let frontier = Infinity;
    for (const l of run.active) if (!l.fixed) frontier = Math.min(frontier, liveTop(l));
    const head = run.queue.find((l) => !l.fixed);
    if (head) frontier = Math.min(frontier, liveTop(head));
    if (frontier === Infinity) return;
    const maxY = document.documentElement.scrollHeight - innerHeight;
    const want = clamp(frontier - innerHeight * CFG.scrollAnchor, 0, maxY);
    if (want > run.scrollY) {
      run.scrollY += Math.max((want - run.scrollY) * 0.06, Math.min(1.5, want - run.scrollY));
      scrollToY(run.scrollY);
    }
  }

  function tick(hud) {
    if (run.stopped) return;
    for (const a of run.agents) {
      if (a.mode === 'drag') updateDragBox(a);
      else if (a.mode === 'select' || a.mode === 'placeholder') updateSelectBox(a);
    }
    if (CFG.autoScroll) autoScroll();
    if (rulers) rulers.draw(rulerBands());
    if (design) design.update();
    const busy = run.agents.filter((a) => a.busy);
    const waiting = !CFG.autoScroll && run.queue.length && !busy.length;
    hud.update({
      busyColors: busy.map((a) => a.color),
      done: run.done,
      total: run.layers.length,
      typing: run.typing > 0,
      hint: waiting ? '↓ 向下滚动继续' : '',
    });
    run.raf = requestAnimationFrame(() => tick(hud));
  }

  // 队首已进入视口（或是固定元素）才允许领取，保证光标都在镜头里。
  // 自动滚动时的兜底：已滚到底或等待超时（如藏在屏幕外的面板）也直接领取，避免死锁
  const HEAD_WAIT_MS = 1500;
  const DUP_WAIT_MS = 2500;
  function headInView(queue) {
    const l = queue[0];
    if (run.waitingFor !== l) {
      run.waitingFor = l;
      run.waitSince = performance.now();
    }
    // 复制任务要等原件搭完（最多等 DUP_WAIT_MS，防止卡死）
    if (l.kind === 'dup' && !l.master.revealed && performance.now() - run.waitSince < DUP_WAIT_MS) return false;
    if (l.fixed) return true;
    if (l.node.getBoundingClientRect().top < innerHeight * 0.92) return true;
    const atBottom = window.scrollY >= document.documentElement.scrollHeight - innerHeight - 2;
    if (atBottom) return true;
    return CFG.autoScroll && performance.now() - run.waitSince > HEAD_WAIT_MS;
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
      const task = queue.shift();
      agent.busy = true;
      const pace = durationScale(CFG.speed) * rand(0.8, 1.2);
      if (task.kind === 'guide') await pullGuide(agent, task, pace);
      else if (task.kind === 'dup') await dupLayer(agent, task, pace);
      else if (task.line) await penLayer(agent, task, pace);
      else await work(agent, task, pace);
    }
    agent.busy = false;
    showCursor(agent, false);
  }

  // keepEngine：录屏还在收尾时先不关音效引擎（关了音轨会提前结束）
  function cleanup(ui, { keepEngine = false } = {}) {
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
    if (run.engine && !keepEngine) {
      run.engine.close(run.finished ? 1.2 : 0.2);
      run.engine = null;
    }
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

  async function tryRecord(audioTrack) {
    try {
      return await startRecording(audioTrack);
    } catch (err) {
      if (err && err.name === 'InvalidStateError') throw err;
      toast(err && err.name === 'NotAllowedError' ? '已取消共享，本次不录屏' : `录屏启动失败：${err && err.message}`);
      return null;
    }
  }

  async function prepareRecording(audioTrack) {
    if (!CFG.record) return null;
    if (!canRecord()) {
      toast('当前浏览器不支持标签页录屏，本次只播放');
      return null;
    }
    try {
      return await tryRecord(audioTrack);
    } catch {
      const choice = await askToStart();
      if (run.engine) await run.engine.resume();
      if (choice !== 'record') return null;
      try { return await tryRecord(audioTrack); } catch { return null; }
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

  // 书签版在本页合成声音（点书签的瞬间有用户激活，必须最先创建）；扩展版由宿主提供通道
  function setupSound() {
    if (!CFG.sound) return;
    if (typeof CFG.sfx === 'function') {
      sfx = createSfx(CFG.sfx);
      return;
    }
    try {
      run.engine = new SoundEngine().init();
      sfx = createSfx(run.engine);
    } catch (err) {
      console.warn('[agent-reveal] 音效不可用', err);
    }
  }

  // 开场：视口内元素自上而下溶解、扫描光带扫过；之后统一切回"立即隐藏"状态
  async function intro(overlay) {
    const vh = innerHeight;
    for (const l of run.layers) {
      const top = l.node.getBoundingClientRect().top;
      hide(l, CFG.intro ? dissolveDelay(top, vh) ?? undefined : undefined);
    }
    if (!CFG.intro) return;
    sfx.intro();
    await scanBeam(overlay);
    for (const l of run.layers) l.node.style.setProperty('transition', 'none', 'important');
  }

  async function start() {
    setupSound();
    run.recording = await prepareRecording(run.engine && run.engine.createTrack());
    // Chrome 开始共享时顶部会出现提示条，等视口稳定后再收集图层
    if (run.recording) await new Promise((r) => setTimeout(r, 800));
    const overlay = el('div', `position:fixed;inset:0;z-index:${Z};pointer-events:none;font:12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;`);
    overlay.setAttribute('data-agent-reveal', '');
    document.documentElement.appendChild(overlay);
    const ui = { overlay };
    scrollToY(0);
    run.layers = buildLayers(overlay, CFG.maxLayers);
    if (!run.layers.length) {
      cleanup(ui);
      alert('Agent Reveal：页面上没有找到可动画的元素。');
      return;
    }

    if (CFG.rulers) {
      design = createDesignLayer(overlay);
      rulers = createRulers(overlay);
    }
    const hud = createHud(overlay, {
      soundOn: true,
      showSound: CFG.sound,
      onClose: () => cleanup(ui),
      onToggleSound: (on) => (run.engine ? run.engine.setOn(on) : sfx.setOn(on)),
    });
    hud.setTotal(run.layers.length);
    run.onKey = (e) => {
      if (e.key === 'Escape') cleanup(ui);
      else if ((e.key === 'm' || e.key === 'M') && CFG.sound && !e.ctrlKey && !e.metaKey && !e.altKey) hud.toggleSound();
    };
    window.addEventListener('keydown', run.onKey, true);
    window.__agentReveal = { stop: () => cleanup(ui), state: run };

    run.raf = requestAnimationFrame(() => tick(hud));
    await intro(overlay);
    if (run.stopped) return;

    const queue = buildQueue(run.layers);
    run.queue = queue;
    const t0 = performance.now();
    const loops = [];
    while (!run.stopped && queue.length) {
      const want = targetAgents(performance.now() - t0);
      while (run.agents.length < want) {
        const agent = createAgent(overlay, run.agents.length, CFG.colors[run.agents.length % CFG.colors.length], CFG.showNames);
        run.agents.push(agent);
        loops.push(agentLoop(agent, queue));
      }
      await sleep(200, run);
    }
    await Promise.all(loops);
    if (run.stopped) return;
    hud.finish();
    sfx.finale();
    await sleep(2200, run);
    if (run.stopped) return;
    // 先停录（保留 Done 画面），再还原页面，最后弹出保存位置
    run.finished = true;
    if (typeof CFG.onDone === 'function') await CFG.onDone();
    const engine = run.engine;
    const recording = finishRecording();
    cleanup(ui, { keepEngine: true });
    await recording;
    if (engine) engine.close(1.2);
    run.engine = null;
  }

  start().catch((err) => {
    console.error('[agent-reveal]', err);
    if (window.__agentReveal) window.__agentReveal.stop();
  });
})();
