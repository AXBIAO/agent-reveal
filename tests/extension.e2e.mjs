// 扩展 E2E：加载 extension/，通过 SW 启动（等同点工具栏），验证录屏保存、真实路径面板、Esc 丢弃
// 用法：node tests/extension.e2e.mjs [--url https://eye.zsf.si]
import { mkdtemp, mkdir, stat, readdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'https://eye.zsf.si';
const srcExtDir = path.join(root, 'extension');
let extDir = srcExtDir;
const outDir = path.join(root, 'artifacts');
const dlDir = path.join(outDir, 'ext-downloads');
const VIEWPORT = { width: 1440, height: 900 };

// 品牌版 Chrome 137+ 禁用了 --load-extension，测试用 Playwright 自带的 Chromium
function findChromium() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!existsSync(base)) return undefined;
  const dirs = spawnSync('cmd', ['/c', 'dir', '/b', '/ad', base]).stdout.toString().split(/\r?\n/)
    .filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const exe = path.join(base, d, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}


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

async function launch(userDataDir, extraArgs = []) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: findChromium(),
    headless: true,
    viewport: VIEWPORT,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, ...extraArgs],
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  return { context, sw, id: new URL(sw.url()).host };
}

async function openTarget(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  // 保留真实文件名（Playwright 默认会把下载改成 GUID 名）
  const cdp = await context.newCDPSession(page);
  // 必须带上页面所属的 browserContextId，否则会被 Playwright 的上下文级设置覆盖
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, browserContextId: targetInfo.browserContextId });
  return { page, errors };
}

const startViaSw = (sw, settings) => sw.evaluate(async ({ target, s }) => {
  const [tab] = await chrome.tabs.query({ url: `${target}/*` });
  try {
    await globalThis.__agentRevealTest.startOnTab(tab.id, s);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}, { target: new URL(url).origin, s: settings });

async function testPopup(context, id) {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${id}/popup.html`);
  await p.waitForTimeout(400);
  const form = await p.evaluate(() => ({
    record: document.getElementById('record').checked,
    agents: document.getElementById('maxAgentsOut').textContent,
    speed: document.getElementById('speedOut').textContent,
  }));
  check('弹窗：载入默认设置', form.record === true && form.agents === '26' && form.speed === '0.70×', JSON.stringify(form));
  await p.screenshot({ path: path.join(outDir, 'ext-popup.png'), clip: { x: 0, y: 0, width: 312, height: 330 } });
  await p.close();
}

async function testFullRun(context, sw) {
  const { page, errors } = await openTarget(context);
  const res = await startViaSw(sw, { record: true, maxAgents: 26, speed: 0.7, showNames: false });
  check('完整播放：启动成功', res.ok, res.error || '');
  await page.waitForTimeout(2500);
  const running = await page.evaluate(() => document.querySelectorAll('[data-agent-reveal]').length === 1);
  check('完整播放：动画在页面中运行', running);
  const toast = await page.evaluate(() => document.body.innerText.includes('录屏未启动'));
  check('完整播放：tabCapture 录屏已启动（无失败提示）', !toast);

  await page.waitForSelector('[data-agent-reveal-saved]', { timeout: 200000 });
  const shown = await page.$eval('[data-agent-reveal-saved] [data-k="path"]', (n) => n.textContent);
  const exists = existsSync(shown);
  const size = exists ? (await stat(shown)).size : 0;
  const probe = exists ? spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', shown]) : null;
  const secs = probe ? parseFloat(String(probe.stdout)) || 0 : 0;
  check('完整播放：面板显示真实保存路径且文件存在', exists && size > 200000, `${shown} ${(size / 1048576).toFixed(1)}MB ${secs.toFixed(1)}s`);
  const derr = exists ? decodeErrors(shown) : -1;
  check('完整播放：视频可完整解码（无花屏）', derr === 0, `ffmpeg 解码错误 ${derr}`);
  const dbad = exists ? dtsProblems(shown) : -1;
  check('完整播放：时间戳严格递增', dbad === 0, `非递增 ${dbad}`);
  // Playwright 会接管下载并改成 GUID 文件名（真实 Chrome 中是 agent-reveal\agent-reveal-<域名>-<时间>.mp4，见单元测试）。
  // 这里验证面板显示的就是 Chrome 下载记录里的真实路径。
  const real = await sw.evaluate(async () => {
    const [item] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 });
    return item && item.filename;
  });
  check('完整播放：面板路径与下载记录一致', real === shown, real);
  await page.screenshot({ path: path.join(outDir, 'ext-saved-panel.png') });
  check('完整播放：无运行时错误', errors.length === 0, errors.join(' | '));
  await page.close();
}

async function testAbort(context, sw) {
  const before = (await readdir(dlDir, { recursive: true })).length;
  const { page } = await openTarget(context);
  const res = await startViaSw(sw, { record: true, maxAgents: 26, speed: 0.7, showNames: false });
  check('中途退出：启动成功', res.ok, res.error || '');
  await page.waitForTimeout(4000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  const sessions = await sw.evaluate(async () => Object.keys(await chrome.storage.session.get(null)));
  check('中途退出：会话已清理', sessions.length === 0, sessions.join(','));
  const after = (await readdir(dlDir, { recursive: true })).length;
  check('中途退出：录屏被丢弃，没有生成文件', after === before, `${before} → ${after}`);
  const again = await startViaSw(sw, { record: true, maxAgents: 26, speed: 0.7, showNames: false });
  check('中途退出：之后可以再次启动录屏', again.ok, again.error || '');
  await page.keyboard.press('Escape');
  await page.close();
}

// 正式扩展只用 activeTab（点工具栏/快捷键时授予）。测试无法点工具栏，
// 所以复制一份并在副本里补 tabs + <all_urls>，正式 manifest 不动。
async function makeTestCopy() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-reveal-ext-src-'));
  await cp(srcExtDir, dir, { recursive: true });
  const mf = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  mf.permissions = [...mf.permissions, 'tabs'];
  mf.host_permissions = ['<all_urls>'];
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(mf, null, 2));
  return dir;
}

async function main() {
  await mkdir(dlDir, { recursive: true });
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'agent-reveal-ext-'));
  extDir = await makeTestCopy();
  // 第一次启动拿扩展 ID，第二次以 allowlist 启动，让 tabCapture 在无工具栏点击时也可用
  const first = await launch(userDataDir);
  const { id } = first;
  await first.context.close();
  const { context, sw } = await launch(userDataDir, [`--allowlisted-extension-id=${id}`]);
  check('扩展加载', !!id, id);
  try {
    await testPopup(context, id);
    await testFullRun(context, sw);
    await testAbort(context, sw);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    await rm(extDir, { recursive: true, force: true }).catch(() => {});
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
