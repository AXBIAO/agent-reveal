// 注入到页面执行的函数：会被 chrome.scripting 序列化，必须自包含（不能引用外部变量）

// 动画配置 + 宿主钩子。运行在扩展的隔离世界里，可直接用 chrome.runtime
export function injectConfig(cfg) {
  window.AGENT_REVEAL_CONFIG = {
    ...cfg,
    record: false, // 录屏由扩展负责
    // 音效转发到离屏文档合成（网页里的 AudioContext 会被自动播放策略挂起）
    sfx: cfg.sound ? (name, args) => { chrome.runtime.sendMessage({ target: 'offscreen', type: 'sfx', name, args }).catch(() => {}); } : null,
    onDone: () => chrome.runtime.sendMessage({ type: 'reveal-done' }),
    onAbort: () => chrome.runtime.sendMessage({ type: 'reveal-abort' }),
  };
}

export function pageToast(text) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483647;padding:9px 16px;border-radius:10px;background:rgba(24,24,27,.94);color:#fff;font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
  t.textContent = text;
  document.documentElement.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// 录屏保存完成：显示真实保存路径，可在文件夹中显示 / 打开
export function showSavedPanel(info) {
  document.querySelectorAll('[data-agent-reveal-saved]').forEach((n) => n.remove());
  const p = document.createElement('div');
  p.setAttribute('data-agent-reveal-saved', '');
  p.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  const card = document.createElement('div');
  card.style.cssText = 'width:min(560px,92vw);background:#18181b;color:#e4e4e7;border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.4)';
  const btn = (label, primary) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:8px 14px;border-radius:9px;cursor:pointer;color:#fff;${primary ? 'border:0;background:#2f7bff' : 'border:1px solid #3f3f46;background:#27272a'}`;
    return b;
  };
  const title = document.createElement('div');
  title.style.cssText = 'font-size:17px;font-weight:600;color:#fff;margin-bottom:12px';
  title.textContent = '✓ 录屏已保存';
  const label = document.createElement('div');
  label.style.opacity = '.6';
  label.textContent = `保存位置（${(info.size / 1048576).toFixed(1)} MB）`;
  const path = document.createElement('div');
  path.setAttribute('data-k', 'path');
  path.style.cssText = 'margin-top:4px;padding:10px 12px;border-radius:9px;background:#27272a;color:#fff;word-break:break-all;user-select:all;font-family:Consolas,monospace;font-size:13px';
  path.textContent = info.path;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px';
  const show = btn('在文件夹中显示');
  const open = btn('打开视频');
  const close = btn('关闭', true);
  show.onclick = () => chrome.runtime.sendMessage({ type: 'show-file', id: info.id });
  open.onclick = () => chrome.runtime.sendMessage({ type: 'open-file', id: info.id });
  close.onclick = () => p.remove();
  row.append(show, open, close);
  card.append(title, label, path, row);
  p.appendChild(card);
  document.documentElement.appendChild(p);
}
