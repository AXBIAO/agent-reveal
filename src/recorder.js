// 当前标签页录屏：getDisplayMedia(preferCurrentTab) + mp4-recorder，结束后下载并弹出保存位置面板
import { createRecorder } from './mp4-recorder.js';

export const canRecord = () => !!(navigator.mediaDevices
  && navigator.mediaDevices.getDisplayMedia && (window.VideoEncoder || window.MediaRecorder));

// 需要用户激活（点书签/点按钮）；没有激活时浏览器抛 InvalidStateError
/** @param {MediaStreamTrack|null} audioTrack 音效音轨（可选） */
export async function startRecording(audioTrack = null) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60 }, width: { ideal: 3840 }, height: { ideal: 2160 }, displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  });
  // 音效来自本页合成器（不录网页其它声音），直接并入录屏流
  const tracks = [...stream.getVideoTracks(), ...(audioTrack ? [audioTrack] : [])];
  return createRecorder(new MediaStream(tracks));
}

export const stopRecording = (r) => r.stop();

export function discardRecording(r) {
  r.discard();
}

const pad = (n) => String(n).padStart(2, '0');

export function recordingName(mime, date = new Date()) {
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const host = location.hostname.replace(/[^a-z0-9.-]/gi, '') || 'page';
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `agent-reveal-${host}-${stamp}.${ext}`;
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 浏览器不向网页暴露下载目录的真实路径，只能给出文件名并说明默认位置
export function showSavedPanel(blob, mime, z) {
  const name = recordingName(mime);
  const url = URL.createObjectURL(blob);
  download(url, name);
  const mb = (blob.size / 1048576).toFixed(1);
  const panel = document.createElement('div');
  panel.setAttribute('data-agent-reveal-saved', '');
  panel.style.cssText = `position:fixed;inset:0;z-index:${z};display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;`;
  panel.innerHTML = `
    <div style="width:min(560px,92vw);background:#18181b;color:#e4e4e7;border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="font-size:17px;font-weight:600;color:#fff;margin-bottom:12px">✓ 录屏已保存</div>
      <video src="${url}" muted autoplay loop playsinline style="width:100%;border-radius:10px;background:#000;max-height:300px"></video>
      <div style="margin-top:14px"><span style="opacity:.6">文件名</span><br><b data-k="name" style="color:#fff;word-break:break-all">${name}</b> <span style="opacity:.6">(${mb} MB)</span></div>
      <div style="margin-top:8px"><span style="opacity:.6">保存位置</span><br><span data-k="where">浏览器默认下载文件夹（Windows 通常是 <b style="color:#fff">此电脑 › 下载</b>）。<br>开了"下载前询问保存位置"的话，就在你刚选的目录。可在 Chrome 菜单 › 下载内容（Ctrl+J）里点"在文件夹中显示"。</span></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
        <button data-k="saveas" style="padding:8px 14px;border-radius:9px;border:1px solid #3f3f46;background:#27272a;color:#fff;cursor:pointer">另存为…</button>
        <button data-k="close" style="padding:8px 14px;border-radius:9px;border:0;background:#2f7bff;color:#fff;cursor:pointer">关闭</button>
      </div>
    </div>`;
  document.documentElement.appendChild(panel);
  const q = (k) => panel.querySelector(`[data-k="${k}"]`);
  const close = () => { URL.revokeObjectURL(url); panel.remove(); };
  q('close').addEventListener('click', close);
  const saveAs = q('saveas');
  if (!window.showSaveFilePicker) saveAs.style.display = 'none';
  saveAs.addEventListener('click', async () => {
    try {
      const ext = name.split('.').pop();
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: '视频', accept: { [mime.split(';')[0]]: [`.${ext}`] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      q('where').textContent = `已另存为 ${handle.name}（就在你刚才选择的目录）`;
    } catch (err) {
      if (err && err.name !== 'AbortError') q('where').textContent = `另存失败：${err.message}`;
    }
  });
  return { name, size: blob.size };
}
