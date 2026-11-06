// 构建：压缩源码 → dist/agent-reveal.min.js、dist/bookmarklet.txt、dist/install.html
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'src', 'agent-reveal.js');
const dist = path.join(root, 'dist');

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

async function main() {
  // 打包 src/ 下的模块为单文件 IIFE（书签只能是一段脚本）
  const result = await build({
    entryPoints: [src], bundle: true, write: false, minify: true,
    format: 'iife', target: 'es2020', charset: 'utf8', legalComments: 'none',
  });
  const min = result.outputFiles[0].text;
  const bookmarklet = `javascript:${encodeURIComponent(min.trim())}`;

  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, 'agent-reveal.min.js'), min);
  // 扩展直接注入同一份脚本；离屏录制页单独打包（含 mp4-muxer）
  await writeFile(path.join(root, 'extension', 'agent-reveal.js'), min);
  await build({
    entryPoints: [path.join(root, 'src', 'offscreen.js')], bundle: true, minify: true,
    format: 'esm', target: 'es2022', charset: 'utf8', legalComments: 'eof',
    outfile: path.join(root, 'extension', 'offscreen.js'),
  });
  await writeFile(path.join(dist, 'bookmarklet.txt'), bookmarklet);
  await writeFile(path.join(dist, 'install.html'), `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Agent Reveal 书签安装</title>
<style>body{font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#222}
a.bm{display:inline-block;padding:10px 18px;border-radius:10px;background:#18181b;color:#fff;text-decoration:none;font-weight:600}
code{background:#f2f2f2;padding:1px 6px;border-radius:4px}</style></head><body>
<h1>Agent Reveal</h1>
<p>1. 显示书签栏（Chrome / Edge：<code>Ctrl+Shift+B</code>）。</p>
<p>2. 把下面的按钮拖到书签栏：</p>
<p><a class="bm" href="${escapeHtml(bookmarklet)}">▶ Agent Reveal</a></p>
<p>3. 打开任意网站，等页面加载完，点书签即可。按 <code>Esc</code> 中途退出，页面会还原。</p>
<p>想调参数，先在控制台设置：<br><code>window.AGENT_REVEAL_CONFIG = { maxAgents: 18, durationMs: 30000, showNames: true }</code></p>
</body></html>
`);
  console.log(`built: ${min.length} bytes min, bookmarklet ${bookmarklet.length} chars`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
