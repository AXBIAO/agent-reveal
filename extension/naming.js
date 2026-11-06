// 录屏文件命名：下载目录下 agent-reveal/agent-reveal-<域名>-<yyyyMMdd-HHmmss>.<ext>

export const SUBDIR = 'agent-reveal';
const pad = (n) => String(n).padStart(2, '0');

export function recordingFileName(host, mime, date = new Date()) {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const safeHost = String(host || '').replace(/[^a-z0-9.-]/gi, '') || 'page';
  const ext = String(mime || '').includes('mp4') ? 'mp4' : 'webm';
  return `${SUBDIR}/agent-reveal-${safeHost}-${stamp}.${ext}`;
}
