// 音效引擎：全部用 WebAudio 实时合成，不含音频文件。
// 输出同时接到扬声器和一条 MediaStream 音轨（供录屏混入）。
// 事件坐标一律用 0–1 的相对位置（xn = x / 视口宽），方便跨页面/离屏文档传递。

const D3 = 50;                        // D3 的 MIDI 号
const PENTA = [0, 2, 4, 7, 9];        // 大调五声音阶：D E F# A B
const BPM = 112;
const MAX_VOICES = 24;                // 同时发声的旋律音上限
const MAX_KEYS_PER_SEC = 40;          // 全局打字声上限
const MAX_CLICKS_PER_SEC = 24;
const NOTE_GAP = 0.45;             // 两个旋律音的最小间隔（秒）
const MIN_NOTE_AREA = 0.004;       // 小于视口面积 0.4% 的块不发旋律音

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

/** 相对横坐标 → 声像（-0.7 左 ~ 0.7 右） */
export function panFor(xn) {
  const n = Number(xn);
  return clamp((Number.isFinite(n) ? n : 0.5) * 1.4 - 0.7, -0.7, 0.7);
}

/**
 * 放下一块内容时的音高：面积越大越低（4 个八度档），越靠右音阶级数越高
 * @param {number} areaFrac 元素面积 / 视口面积
 * @param {number} xn 相对横坐标
 * @returns {number} MIDI 号
 */
export function placeNote(areaFrac, xn) {
  const oct = areaFrac > 0.08 ? 0 : areaFrac > 0.015 ? 1 : areaFrac > 0.002 ? 2 : 3;
  const deg = Math.floor(clamp(Number(xn) || 0, 0, 0.999) * PENTA.length);
  return D3 + oct * 12 + PENTA[deg];
}

/** 下一个节拍网格时刻（div=2 为 8 分音符） */
export function nextGridTime(now, t0, bpm = BPM, div = 2) {
  const step = 60 / bpm / div;
  const k = Math.ceil((now + 0.01 - t0) / step);
  return { when: t0 + k * step, slot: k };
}

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.voiceEnds = [];
    this.recent = { key: [], click: [] };
    this.usedSlots = new Set();
    this.lastNote = -Infinity;
    this.stats = { notes: 0, keys: 0, clicks: 0 }; // 实际发出的声音数（测试用来检查音效密度）
  }

  /** 必须在用户激活期间或扩展页面里调用，否则浏览器会把 AudioContext 挂起 */
  init() {
    if (this.ctx) return this;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.on ? 1 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(this.out);
    this.out.connect(ctx.destination);
    this.room = ctx.createConvolver();
    this.room.buffer = this.makeRoom(2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.room.connect(wet).connect(this.master);
    this.noiseBuf = this.makeNoise(1);
    this.t0 = ctx.currentTime;
    return this;
  }

  /** 每次录屏新建一条音轨（录屏结束会停止它，不能复用） */
  createTrack() {
    if (!this.ctx) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.out.connect(dest);
    return dest.stream.getAudioTracks()[0];
  }

  get state() {
    return this.ctx ? this.ctx.state : 'none';
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume().catch(() => {});
    return Promise.resolve();
  }

  setOn(on) {
    this.on = Boolean(on);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(this.on ? 1 : 0, t, 0.04);
  }

  close(fadeSec = 0.4) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.out.gain.setTargetAtTime(0, ctx.currentTime, fadeSec / 3);
    setTimeout(() => ctx.close().catch(() => {}), fadeSec * 1000 + 200);
    this.ctx = null;
  }

  // ---------- 声源 ----------
  makeNoise(sec) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * sec), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 生成的小房间混响：指数衰减的双声道噪声
  makeRoom(sec) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * sec);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
    }
    return buf;
  }

  voice(when, pan, reverb) {
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    p.pan.setValueAtTime(pan, when);
    g.connect(p).connect(this.master);
    if (reverb) {
      const s = this.ctx.createGain();
      s.gain.value = reverb;
      p.connect(s).connect(this.room);
    }
    return g;
  }

  // 带通滤波的噪声短脉冲：点击、按键、吸附
  burst(when, pan, freq, q, vel, len, reverb = 0.05) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = this.voice(when, pan, reverb);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0005, when + len);
    src.connect(bp).connect(g);
    src.start(when, Math.random() * 0.8);
    src.stop(when + len + 0.02);
    src.onended = () => g.disconnect();
  }

  // 木琴音：基频 + 4 倍、9.2 倍泛音，泛音衰减更快
  mallet(midi, when, vel, pan, ring) {
    const now = this.ctx.currentTime;
    this.voiceEnds = this.voiceEnds.filter((e) => e > now);
    if (this.voiceEnds.length >= MAX_VOICES) return;
    const f = mtof(midi);
    const v = this.voice(when, pan, 0.5);
    v.gain.value = vel;
    let last = null;
    for (const [ratio, amp, decay] of [[1, 1, 1], [4, 0.22, 0.25], [9.2, 0.06, 0.1]]) {
      if (f * ratio > 14000) continue;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(amp, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, when + ring * decay);
      o.connect(g).connect(v);
      o.start(when);
      o.stop(when + ring * decay + 0.05);
      last = o;
    }
    this.burst(when, pan, Math.min(8000, f * 6), 1.5, vel * 0.25, 0.012, 0);
    this.voiceEnds.push(when + ring);
    this.stats.notes += 1;
    if (last) last.onended = () => v.disconnect();
  }

  limited(kind, max) {
    const now = this.ctx.currentTime;
    this.recent[kind] = this.recent[kind].filter((t) => now - t < 1);
    if (this.recent[kind].length >= max) return true;
    this.recent[kind].push(now);
    return false;
  }

  ready() {
    return Boolean(this.ctx) && this.on && this.ctx.state === 'running';
  }

  // ---------- 事件 ----------
  play(name, args = []) {
    if (!this.ready() || typeof this[`sfx_${name}`] !== 'function') return;
    this[`sfx_${name}`](...args);
  }

  sfx_press(xn) {
    if (this.limited('click', MAX_CLICKS_PER_SEC)) return;
    this.stats.clicks += 1;
    const t = this.ctx.currentTime + 0.003;
    const pan = panFor(xn);
    this.burst(t, pan, rand(2200, 2800), 4, 0.28, 0.011);
    this.burst(t + 0.002, pan, rand(600, 800), 2, 0.14, 0.024);
  }

  sfx_release(xn) {
    if (this.limited('click', MAX_CLICKS_PER_SEC)) return;
    this.burst(this.ctx.currentTime + 0.003, panFor(xn), rand(3000, 3600), 4, 0.12, 0.008);
  }

  // 拖拽：带通扫频的轻微气流声，时长跟拖拽时长一致
  sfx_swish(xn, sec) {
    const len = clamp(Number(sec) || 0.3, 0.12, 1.2);
    const t = this.ctx.currentTime + 0.005;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + len);
    const g = this.voice(t, panFor(xn), 0.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + len * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    src.connect(bp).connect(g);
    src.start(t);
    src.stop(t + len + 0.05);
    src.onended = () => g.disconnect();
  }

  sfx_key(xn, space) {
    if (this.limited('key', MAX_KEYS_PER_SEC)) return;
    this.stats.keys += 1;
    const t = this.ctx.currentTime + 0.003;
    const pan = panFor(xn);
    this.burst(t, pan, rand(3800, 5400), 2.4, rand(0.12, 0.18), rand(0.006, 0.01));
    this.burst(t + 0.002, pan, space ? rand(420, 560) : rand(900, 1400), 1.8, space ? 0.16 : rand(0.08, 0.12), space ? 0.05 : 0.03);
  }

  sfx_backspace(xn) {
    if (this.limited('key', MAX_KEYS_PER_SEC)) return;
    const t = this.ctx.currentTime + 0.003;
    this.burst(t, panFor(xn), rand(2600, 3200), 2.4, 0.13, 0.009);
    this.burst(t + 0.002, panFor(xn), rand(700, 900), 1.8, 0.1, 0.035);
  }

  // 放下一块内容：以点击声为主，旋律只做点缀。
  // 文字和按钮不响；太小的块不响；对齐四分音符网格，两个音至少间隔 NOTE_GAP 秒；音量很轻
  sfx_place(kind, xn, areaFrac) {
    if (kind === 'text' || kind === 'control') return;
    const area = Number(areaFrac) || 0;
    if (area < MIN_NOTE_AREA) return;
    const now = this.ctx.currentTime;
    if (now - this.lastNote < NOTE_GAP) return;
    const { when, slot } = nextGridTime(now, this.t0, BPM, 1);
    if (this.usedSlots.has(slot)) return;
    this.usedSlots.add(slot);
    if (this.usedSlots.size > 64) this.usedSlots.delete(this.usedSlots.values().next().value);
    this.lastNote = when;
    const midi = placeNote(area, xn);
    const vel = kind === 'media' ? 0.09 : 0.065;
    this.mallet(midi, when, vel, panFor(xn), midi < D3 + 12 ? 1.8 : 1.1);
  }

  // 大标题逐级放大：一声音调逐级升高的轻响
  sfx_grow(xn, step) {
    const t = this.ctx.currentTime + 0.003;
    this.burst(t, panFor(xn), 2200 + (Number(step) || 0) * 300, 5, 0.09, 0.01);
  }
  sfx_snap(xn) {
    const t = this.ctx.currentTime + 0.003;
    this.burst(t, panFor(xn), 5200, 3, 0.22, 0.01);
    this.burst(t + 0.002, panFor(xn), 1300, 2, 0.12, 0.025);
  }

  // 从标尺拉出参考线：短促上扬的"嗞"
  sfx_guide(xn) {
    const t = this.ctx.currentTime + 0.003;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(1800, t + 0.12);
    const g = this.voice(t, panFor(xn), 0.2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.2);
    o.onended = () => g.disconnect();
  }

  // 开场：上扬的空气声 + 低音五度铺底
  sfx_intro() {
    const t = this.ctx.currentTime + 0.02;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 1.1);
    const g = this.voice(t, 0, 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 1.8);
    src.connect(bp).connect(g);
    src.start(t);
    src.stop(t + 1.9);
    src.onended = () => g.disconnect();
    for (const [m, d] of [[D3 - 12, 0], [D3 - 5, 0.1], [D3, 0.2]]) this.pad(mtof(m), t + 0.2 + d, 0.05, 2.4);
  }

  pad(freq, when, vel, len) {
    const g = this.voice(when, 0, 0.8);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + len * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0005, when + len);
    for (const detune of [-5, 5]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(g);
      o.start(when);
      o.stop(when + len + 0.05);
    }
  }

  // 结尾：D 大调加九音琶音
  sfx_finale() {
    const { when } = nextGridTime(this.ctx.currentTime, this.t0);
    const chord = [D3, D3 + 7, D3 + 12, D3 + 16, D3 + 19, D3 + 24, D3 + 26, D3 + 31];
    chord.forEach((m, i) => this.mallet(m, when + i * 0.045, 0.22 - i * 0.012, -0.5 + (i / chord.length), 3));
    this.pad(mtof(D3), when, 0.04, 4);
  }
}

// 页面端的发送器：书签版直接驱动本页引擎；扩展版把事件转发到离屏文档
export function createSfx(sink) {
  const send = typeof sink === 'function' ? sink : (name, args) => sink.play(name, args);
  return new Proxy({}, {
    get: (_t, name) => (...args) => { try { send(String(name), args); } catch { /* 声音失败不影响动画 */ } },
  });
}
