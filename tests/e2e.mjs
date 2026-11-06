// E2E：在真实站点注入书签脚本，验证动画运行、自然结束还原、Esc 中止还原
// 用法：node tests/e2e.mjs [--url https://eye.zsf.si] [--record]
import { readFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'https://eye.zsf.si';
const record = args.includes('--record');
const outDir = path.join(root, 'artifacts');
const VIEWPORT = { width: 1440, height: 900 };


// 录屏质量：ffmpeg 完整解码，统计错误数（之前 MediaRecorder mp4 每段上百个错误、大面积花屏）
// 只计真正的解码错误；ffmpeg 写空输出时对可变帧率做时间刻度换算产生的 dts 警告不算（文件本身见 dtsProblems）
function decodeErrors(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-fps_mode', 'passthrough', '-f', 'null', '-']);
  return String(r.stderr).split('\n').filter((l) => l.trim() && !/non monotonically increasing dts/.test(l)).length;
}

// 文件里原始 dts 必须严格递增
function dtsProblems(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=dts', '-of', 'csv=p=0', file], { maxBuffer: 64 << 20 });
  const dts = String(r.stdout).split(/\r?\n/).filter(Boolean).map(Number);
  let bad = 0;
  for (let i = 1; i < dts.length; i += 1) if (!(dts[i] > dts[i - 1])) bad += 1;
  return dts.length ? bad : -1;
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// 还原检查一：DOM 结构/文本/class 与运行前一致（忽略 style，页面自带的滑块等会自己改 style）
const domSignature = () => document.body.innerHTML.replace(/ style="[^"]*"/g, '');
// 还原检查二：没有残留脚本写入的 !important 样式
const leftoverStyles = () => [...document.querySelectorAll('[style]')]
  .filter((n) => ['opacity', 'transition', 'filter'].some((p) => n.style.getPropertyPriority(p) === 'important'))
  .map((n) => `${n.tagName.toLowerCase()}.${n.className}`.slice(0, 80));

// 先把整页滚一遍触发页面自带的滚动出现动画，避免把站点自身的 class 变化误判为脚本残留
async function settlePage(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(800);
}

async function openPage(browser, withVideo) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    ...(withVideo ? { recordVideo: { dir: outDir, size: VIEWPORT } } : {}),
  });
  const page = await context.newPage();
  const t0 = Date.now();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && m.text().includes('agent-reveal')) errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await settlePage(page);
  return { context, page, errors, t0 };
}

async function testFullRun(browser, code) {
  const { context, page, errors, t0 } = await openPage(browser, record);
  const before = await page.evaluate(domSignature);
  const tStart = (Date.now() - t0) / 1000;
  await page.evaluate(NO_RECORD);
  await page.evaluate(code);
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => {
    const s = window.__agentReveal && window.__agentReveal.state;
    return s ? { total: s.layers.length, hidden: s.layers.filter((l) => !l.revealed).length } : null;
  });
  check('脚本启动并收集图层', !!state && state.total > 20, state ? `${state.total} layers` : 'no state');
  check('启动后大部分图层处于隐藏', !!state && state.hidden / state.total > 0.8);
  check('覆盖层与状态条存在', await page.locator('[data-agent-reveal]').count() === 1);

  // 每 0.5s 采样：闲置光标必须隐藏；要观察到拖拽拉框状态
  const shots = new Set([8, 24, 48]);
  const stats = { idleVisible: 0, dragSeen: 0, maxBusy: 0, samples: 0, typos: 0 };
  for (let i = 1; i <= 48; i += 1) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => {
      const st = window.__agentReveal && window.__agentReveal.state;
      if (!st) return null;
      return {
        idleVisible: st.agents.filter((a) => !a.busy && a.cursor.style.opacity !== '0').length,
        drag: st.agents.filter((a) => a.mode === 'drag').length,
        busy: st.agents.filter((a) => a.busy).length,
        typos: st.typos,
      };
    });
    if (!s) break;
    stats.samples += 1;
    stats.idleVisible = Math.max(stats.idleVisible, s.idleVisible);
    stats.dragSeen += s.drag;
    stats.maxBusy = Math.max(stats.maxBusy, s.busy);
    stats.typos = Math.max(stats.typos, s.typos);
    if (shots.has(i)) await page.screenshot({ path: path.join(outDir, `run-${String(i / 2).padStart(2, '0')}s.png`) });
  }
  check('闲置光标全部隐藏', stats.idleVisible === 0, `max idle visible ${stats.idleVisible} / ${stats.samples} samples`);
  check('观察到拖拽拉框', stats.dragSeen > 0, `drag samples ${stats.dragSeen}, max busy ${stats.maxBusy}`);
  check('出现打错再改的打字', stats.typos > 0, `typos ${stats.typos}`);
  const mid = await page.evaluate(() => {
    const s = window.__agentReveal && window.__agentReveal.state;
    return s ? { agents: s.agents.length, done: s.done } : null;
  });
  check('中段 agent 数已增长', !!mid && mid.agents >= 10, mid ? `${mid.agents} agents, ${mid.done} done` : 'ended early');

  await page.waitForFunction(() => !window.__agentReveal, null, { timeout: 90000 });
  const tEnd = (Date.now() - t0) / 1000;
  console.log(`      动画时长 ${(tEnd - tStart).toFixed(1)}s`);
  check('动画自然结束并移除覆盖层', await page.locator('[data-agent-reveal]').count() === 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const after = await page.evaluate(domSignature);
  check('结束后页面 DOM 完整还原', before === after, `before ${before.length} / after ${after.length}`);
  const left = await page.evaluate(leftoverStyles);
  check('结束后无残留样式', left.length === 0, left.slice(0, 5).join(', '));
  check('无运行时错误', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: path.join(outDir, 'run-end.png') });
  const video = page.video();
  await context.close();
  if (video) exportMp4(await video.path(), tStart, tEnd + 0.5);
}

// 把录屏裁成只含动画的 mp4（需要系统 ffmpeg）
function exportMp4(webm, from, to) {
  const out = path.join(outDir, 'demo.mp4');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(from), '-to', String(to), '-i', webm,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out]);
  console.log(r.status === 0 ? `      录屏已导出 ${out}` : `      ffmpeg 导出失败：${r.stderr}`);
}

// 主测试不录屏（evaluate 没有用户激活，录屏会弹"开始"面板）
const NO_RECORD = () => { window.AGENT_REVEAL_CONFIG = { record: false }; };

// 录屏：用真实点击触发（等同点书签的用户激活），自动接受标签页共享，验证下载出视频且弹出保存面板
async function testRecording(code) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--auto-accept-this-tab-capture'] })
    .catch(() => chromium.launch({ args: ['--auto-accept-this-tab-capture'] }));
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.evaluate((src) => {
      const b = document.createElement('button');
      b.id = '__ar_go';
      b.textContent = 'go';
      b.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647';
      b.onclick = () => { b.remove(); (0, eval)(src); };
      document.body.appendChild(b);
    }, code);
    const downloadP = page.waitForEvent('download', { timeout: 180000 });
    await page.click('#__ar_go');
    await page.waitForTimeout(3000);
    const recording = await page.evaluate(() => !!(window.__agentReveal && window.__agentReveal.state.recording));
    check('录屏：点击后开始录制当前标签页', recording);
    const download = await downloadP;
    const file = path.join(outDir, download.suggestedFilename());
    await download.saveAs(file);
    const size = (await stat(file)).size;
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const secs = parseFloat(String(probe.stdout)) || 0;
    check('录屏：完成后自动下载视频文件', size > 200000, `${download.suggestedFilename()} ${(size / 1048576).toFixed(1)}MB ${secs.toFixed(1)}s`);
    await page.waitForTimeout(500);
    const derr = decodeErrors(file);
    check('录屏：视频可完整解码（无花屏）', derr === 0, `ffmpeg 解码错误 ${derr}`);
    const dbad = dtsProblems(file);
    check('录屏：时间戳严格递增', dbad === 0, `非递增 ${dbad}`);
    check('录屏：弹出保存位置面板', await page.locator('[data-agent-reveal-saved]').count() === 1);
    await page.screenshot({ path: path.join(outDir, 'saved-panel.png') });
    check('录屏流程无运行时错误', errors.length === 0, errors.join(' | '));
    console.log(`      浏览器录屏已保存 ${file}`);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function testEscape(browser, code) {
  const { context, page, errors } = await openPage(browser, false);
  const before = await page.evaluate(domSignature);
  await page.evaluate(NO_RECORD);
  await page.evaluate(code);
  await page.waitForTimeout(3500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc 中止后覆盖层移除', await page.locator('[data-agent-reveal]').count() === 0);
  const after = await page.evaluate(domSignature);
  check('Esc 中止后 DOM 完整还原', before === after, `before ${before.length} / after ${after.length}`);
  const left = await page.evaluate(leftoverStyles);
  check('Esc 中止后无残留样式', left.length === 0, left.slice(0, 5).join(', '));
  check('Esc 流程无运行时错误', errors.length === 0, errors.join(' | '));
  await context.close();
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const code = await readFile(path.join(root, 'dist', 'agent-reveal.min.js'), 'utf8');
  // 优先用本机 Chrome，免得每次 Playwright 升级都要重下内核
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  try {
    await testFullRun(browser, code);
    await testEscape(browser, code);
  } finally {
    await browser.close();
  }
  await testRecording(code);
  if (record && process.platform === 'win32') spawnSync('explorer.exe', [`/select,${path.join(outDir, 'demo.mp4')}`]);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
