// 生成 README 用的界面截图：保存面板（示意路径）。用法：node scripts/docs-shots.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { showSavedPanel } from '../extension/page-ui.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SAMPLE = {
  path: 'C:\\Users\\you\\Downloads\\agent-reveal\\agent-reveal-eye.zsf.si-20261106-221500.mp4',
  size: 93.6 * 1048576,
  id: 1,
};

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 2 });
await page.setContent('<body style="margin:0;background:#f7f5ef"></body>');
await page.evaluate(`(${showSavedPanel.toString()})(${JSON.stringify(SAMPLE)})`);
const card = page.locator('[data-agent-reveal-saved] > div');
await card.screenshot({ path: path.join(root, 'docs', 'saved-panel.png') });
await browser.close();
console.log('docs/saved-panel.png');
