// 音画同步 E2E：页面每 2 秒闪白 + 同时发一声，用真实录制管线（标签页采集 + mp4-recorder + sound）录 11 秒，
// 再用 ffmpeg 找出画面闪白时刻与声音起始时刻，要求偏差在 ±60ms 内、两条轨道时长一致。
// 用法：node tests/av-sync.e2e.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'artifacts');
const MAX_OFFSET_MS = 60;
const argv = process.argv.slice(2);
const FLASHES = argv.includes('--flashes') ? Number(argv[argv.indexOf('--flashes') + 1]) : 5;
// 默认有界面：无头模式没有真实声卡，WebAudio 由模拟设备驱动，时钟会比真实时间慢约 1%
const HEADLESS = argv.includes('--headless');
// 模拟主线程繁忙（真实录屏时页面在跑动画、反复排版）：每 100ms 里占满 90ms
const LOAD = argv.includes('--load');
// 默认用 getDisplayMedia 录当前标签页（与书签版、扩展录屏同一类采集路径）；--canvas 改用 canvas 画面
const TAB = !argv.includes('--canvas');
// 模拟真实播放时的音效负载：每秒约 60 次按键 + 点击 + 放置音（几十个光标同时干活）
const SFX_LOAD = argv.includes('--sfx-load');
// 模拟录屏开始后的一次长任务（收集几百个图层时主线程会连续卡 1–2 秒）
const LONG_TASK = !argv.includes('--no-long-task');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function bundle() {
  const entry = `import { createRecorder } from './src/mp4-recorder.js';
import { SoundEngine } from './src/sound.js';
window.__sync = { createRecorder, SoundEngine };`;
  const r = await build({ stdin: { contents: entry, resolveDir: root }, bundle: true, write: false, format: 'iife' });
  return r.outputFiles[0].text;
}

async function record(code) {
  // 有界面模式：无头模式下 WebAudio 与画布采集的节奏和真实使用不同
  const args = ['--autoplay-policy=no-user-gesture-required', '--auto-accept-this-tab-capture'];
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, args })
    .catch(() => chromium.launch({ headless: HEADLESS, args }));
  try {
    const page = await browser.newPage();
    await page.goto('https://example.com');
    await page.addScriptTag({ content: code });
    if (TAB) {
      // getDisplayMedia 需要用户激活：放一个按钮让 Playwright 真实点击
      await page.evaluate(() => {
        const b = document.createElement('button');
        b.id = 'go';
        b.textContent = 'go';
        document.body.appendChild(b);
        b.onclick = async () => {
          window.__tabStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false, preferCurrentTab: true });
        };
      });
      await page.click('#go');
      await page.waitForFunction(() => !!window.__tabStream, null, { timeout: 15000 });
    }
    const bytes = await page.evaluate(async ({ n, load, sfxLoad, longTask }) => {
      const { createRecorder, SoundEngine } = window.__sync;
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      document.body.appendChild(c);
      const g = c.getContext('2d');
      const engine = new SoundEngine().init();
      await engine.resume();
      const fill = document.createElement('div');
      fill.style.cssText = 'position:fixed;inset:0;z-index:9;background:#000';
      if (window.__tabStream) document.body.appendChild(fill);
      let flashUntil = 0;
      const draw = () => {
        if (window.__tabStream) fill.style.background = performance.now() < flashUntil ? '#fff' : '#000';
        g.fillStyle = performance.now() < flashUntil ? '#fff' : '#000';
        g.fillRect(0, 0, 640, 360);
        requestAnimationFrame(draw);
      };
      draw();
      const vtrack = window.__tabStream ? window.__tabStream.getVideoTracks()[0] : c.captureStream(60).getVideoTracks()[0];
      const rec = createRecorder(new MediaStream([vtrack, engine.createTrack()]));
      const busy = load ? setInterval(() => { const t = performance.now(); while (performance.now() - t < 90); }, 100) : 0;
      const noisy = sfxLoad ? setInterval(() => {
        engine.play('key', [Math.random(), false]);
        if (Math.random() < 0.3) engine.play('press', [Math.random()]);
        if (Math.random() < 0.1) engine.play('swish', [Math.random(), 0.4]);
        if (Math.random() < 0.05) engine.play('place', ['media', Math.random(), 0.05]);
      }, 16) : 0;
      // 开头留 1 秒给编码器预热（预热时积压会触发丢帧，短闪白可能被丢掉）
      await new Promise((r) => setTimeout(r, 500));
      if (longTask) { const t = performance.now(); while (performance.now() - t < 1500); }
      await new Promise((r) => setTimeout(r, 500));
      for (let i = 0; i < n; i += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        flashUntil = performance.now() + 250;
        engine.play('snap', [0.5]);
      }
      await new Promise((r) => setTimeout(r, 1000));
      clearInterval(busy);
      clearInterval(noisy);
      const blob = await rec.stop();
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, { n: FLASHES, load: LOAD, sfxLoad: SFX_LOAD, longTask: LONG_TASK });
    return Buffer.from(bytes);
  } finally {
    await browser.close();
  }
}

function flashTimes(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { maxBuffer: 64 << 20 });
  const times = [];
  let ts = 0;
  let prev = 0;
  for (const line of String(r.stdout).split(/\r?\n/)) {
    const t = /pts_time:([\d.]+)/.exec(line);
    if (t) ts = Number(t[1]);
    const y = /YAVG=([\d.]+)/.exec(line);
    if (y) {
      const v = Number(y[1]);
      // 忽略开头 0.5 秒：标签页采集的第一帧可能还是白底网页，会被误判成一次闪白
      if (v > 128 && prev <= 128 && ts > 0.5) times.push(ts);
      prev = v;
    }
  }
  return times;
}

function soundTimes(file) {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'silencedetect=n=-45dB:d=0.3', '-f', 'null', '-']);
  return [...String(r.stderr).matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
}

function durations(file) {
  const get = (sel) => parseFloat(String(spawnSync('ffprobe', ['-v', 'error', '-select_streams', sel, '-show_entries', 'stream=duration', '-of', 'csv=p=0', file]).stdout)) || 0;
  return { video: get('v'), audio: get('a') };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, 'av-sync.mp4');
  await writeFile(file, await record(await bundle()));
  const flashes = flashTimes(file);
  const sounds = soundTimes(file).filter((t) => t > 0.5);
  // 允许漏检一次（偶发丢帧），其余每一次都必须同步
  check('画面闪白基本都检测到（最多漏 1 次）', flashes.length >= FLASHES - 1, flashes.map((t) => t.toFixed(3)).join(' '));
  check('声音全部检测到', sounds.length >= FLASHES, sounds.map((t) => t.toFixed(3)).join(' '));
  // 每一声配离它最近的闪白（500ms 内）：个别帧漏检时不会整体错位
  const offsets = sounds.slice(0, FLASHES).map((s) => {
    const f = flashes.reduce((best, t) => (Math.abs(t - s) < Math.abs(best - s) ? t : best), Infinity);
    return Math.abs(f - s) <= 0.5 ? Math.round((s - f) * 1000) : NaN;
  });
  const matched = offsets.filter(Number.isFinite);
  const worst = matched.length >= FLASHES - 1 ? Math.max(...matched.map(Math.abs)) : NaN;
  check(`音画同步：偏差在 ±${MAX_OFFSET_MS}ms 内`, Number.isFinite(worst) && worst <= MAX_OFFSET_MS, `声音 - 画面 = ${offsets.join(', ')} ms`);
  const d = durations(file);
  check('音视频时长一致', Math.abs(d.video - d.audio) < 0.15, `视频 ${d.video.toFixed(2)}s 音频 ${d.audio.toFixed(2)}s`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
