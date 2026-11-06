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


// 录屏音轨：编码格式与峰值音量（dB）。没有音轨返回 null
function audioInfo(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file]);
  const codec = String(probe.stdout).trim();
  if (!codec) return null;
  const vd = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(String(vd.stderr));
  const dur = (sel) => parseFloat(String(spawnSync('ffprobe', ['-v', 'error', '-select_streams', sel, '-show_entries', 'stream=duration', '-of', 'csv=p=0', file]).stdout)) || 0;
  return { codec, maxDb: m ? Number(m[1]) : -Infinity, gap: Math.abs(dur('v') - dur('a')) };
}

// 设计辅助层的可见元素数：标尺画布、参考线、红线（按颜色识别）
const designCounts = () => {
  const o = document.querySelector('[data-agent-reveal]');
  if (!o) return null;
  const divs = [...o.querySelectorAll('div')];
  const has = (rgb) => divs.filter((d) => (d.style.background || d.style.backgroundColor || '').includes(rgb)).length;
  // 标尺平时收在屏幕外（transform 非 none），拉参考线时滑入
  const shown = [...o.querySelectorAll('canvas')].filter((cv) => cv.style.transform === 'none').length;
  return { rulers: shown, guides: has('242, 56, 124'), redlines: has('242, 59, 59') };
};
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
  const stats = { idleVisible: 0, dragSeen: 0, maxBusy: 0, samples: 0, typos: 0, rulers: 0, rulersShown: 0, guides: 0, redlines: 0, dupTasks: 0, dupSeen: 0, penSeen: 0 };
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
        dupTasks: (st.dupTasks || []).length,
        dup: st.agents.some((a) => a.badge && a.badge.style.opacity === '1'),
        pen: st.agents.some((a) => a.tool === 'pen'),
      };
    });
    if (!s) break;
    stats.samples += 1;
    stats.idleVisible = Math.max(stats.idleVisible, s.idleVisible);
    stats.dragSeen += s.drag;
    stats.maxBusy = Math.max(stats.maxBusy, s.busy);
    stats.typos = Math.max(stats.typos, s.typos);
    stats.dupTasks = Math.max(stats.dupTasks, s.dupTasks);
    if (s.dup) stats.dupSeen += 1;
    if (s.pen) stats.penSeen += 1;
    const dc = await page.evaluate(designCounts);
    if (dc) {
      stats.rulers = Math.max(stats.rulers, dc.rulers);
      if (dc.rulers === 2) stats.rulersShown += 1;
      stats.guides = Math.max(stats.guides, dc.guides);
      stats.redlines = Math.max(stats.redlines, dc.redlines);
    }
    if (shots.has(i)) await page.screenshot({ path: path.join(outDir, `run-${String(i / 2).padStart(2, '0')}s.png`) });
  }
  check('闲置光标全部隐藏', stats.idleVisible === 0, `max idle visible ${stats.idleVisible} / ${stats.samples} samples`);
  check('观察到拖拽拉框', stats.dragSeen > 0, `drag samples ${stats.dragSeen}, max busy ${stats.maxBusy}`);
  check('出现打错再改的打字', stats.typos > 0, `typos ${stats.typos}`);
  check('标尺在拉参考线时滑入（顶部 + 左侧）', stats.rulers === 2, `最多同时 ${stats.rulers} 条`);
  check('标尺大部分时间收起，不遮挡网页内容', stats.rulersShown / Math.max(1, stats.samples) < 0.5, `显示 ${stats.rulersShown} / ${stats.samples} 次采样`);
  check('出现参考线', stats.guides > 0, `最多同时 ${stats.guides} 条`);
  check('识别出重复组件', stats.dupTasks > 0, `复制任务 ${stats.dupTasks} 个`);
  check('观察到 ⌥ 拖拽复制', stats.dupSeen > 0, `采样到 ${stats.dupSeen} 次`);
  check('观察到钢笔画线', stats.penSeen > 0, `采样到 ${stats.penSeen} 次`);
  check('出现间距红线', stats.redlines > 0, `最多同时 ${stats.redlines} 条`);
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
    const ai = audioInfo(file);
    check('录屏：带音效音轨且不是静音', !!ai && ai.maxDb > -45, ai ? `${ai.codec} 峰值 ${ai.maxDb} dB` : '没有音轨');
  check('录屏：音视频时长一致', !!ai && ai.gap < 0.3, ai ? `相差 ${ai.gap.toFixed(2)}s` : '没有音轨');
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
