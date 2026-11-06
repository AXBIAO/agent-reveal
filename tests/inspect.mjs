// 调试：运行中途打印 agent 正在处理的图层位置，以及图层的分布
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://eye.zsf.si';
const code = await readFile(new URL('../dist/agent-reveal.min.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(code);
const dump = () => page.evaluate(() => {
  const s = window.__agentReveal.state;
  const desc = (l) => {
    const r = l.node.getBoundingClientRect();
    return `${l.kind.padEnd(7)} ${l.node.tagName.toLowerCase()}.${String(l.node.className).slice(0, 28).padEnd(28)} top=${Math.round(l.top)} vis=(${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)})`;
  };
  const docH = document.documentElement.scrollHeight;
  const buckets = {};
  for (const l of s.layers) { const k = Math.floor(l.top / 1000) * 1000; buckets[k] = (buckets[k] || 0) + 1; }
  return { scrollY: Math.round(scrollY), docH, done: s.done, buckets, active: [...s.active].map(desc) };
});
for (const t of [3000, 6000, 6000]) {
  await page.waitForTimeout(t);
  console.log(JSON.stringify(await dump(), null, 1));
}
await browser.close();
