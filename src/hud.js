// 右下角状态条：头像、agents、layers、进度、Typing/提示、声音开关、关闭

const SPEAKER_ON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 6v4h2.5l3.5 3V3L5 6z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4"/></svg>';
const SPEAKER_OFF = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 6v4h2.5l3.5 3V3L5 6z" fill="currentColor"/><path d="M11 6l3.5 3.5M14.5 6L11 9.5"/></svg>';
const MAX_AVATARS = 5;

export function createHud(overlay, { soundOn, showSound, onClose, onToggleSound }) {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:18px;bottom:18px;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:12px;background:rgba(24,24,27,.92);color:#e4e4e7;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:auto;backdrop-filter:blur(8px);';
  bar.innerHTML = `
    <span data-k="avatars" style="display:flex;padding-left:6px"></span>
    <span><b data-k="agents" style="color:#fff">0</b> agents</span>
    <span style="opacity:.35">|</span>
    <span><b data-k="done" style="color:#fff">0</b> / <span data-k="total">0</span> layers</span>
    <span style="width:72px;height:4px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden"><span data-k="prog" style="display:block;height:100%;width:0;background:#2f7bff;transition:width .2s"></span></span>
    <span data-k="typing" style="padding:2px 7px;border-radius:6px;background:rgba(47,123,255,.22);color:#9ec1ff;opacity:0;transition:opacity .2s;white-space:nowrap">Typing…</span>
    <span data-k="sound" title="声音" style="cursor:pointer;opacity:.75;display:${showSound ? 'flex' : 'none'}">${soundOn ? SPEAKER_ON : SPEAKER_OFF}</span>
    <span data-k="close" title="Esc 退出" style="cursor:pointer;opacity:.55;padding:0 2px">✕</span>`;
  overlay.appendChild(bar);
  const q = (k) => bar.querySelector(`[data-k="${k}"]`);
  const refs = { avatars: q('avatars'), agents: q('agents'), done: q('done'), total: q('total'), prog: q('prog'), typing: q('typing'), sound: q('sound'), close: q('close') };
  let sound = soundOn;
  let avatarKey = '';
  refs.close.addEventListener('click', onClose);
  const toggleSound = () => {
    sound = !sound;
    refs.sound.innerHTML = sound ? SPEAKER_ON : SPEAKER_OFF;
    onToggleSound(sound);
  };
  refs.sound.addEventListener('click', toggleSound);

  return {
    bar,
    refs,
    toggleSound,
    setTotal(n) { refs.total.textContent = String(n); },
    /** 每帧更新 */
    update({ busyColors, done, total, typing, hint }) {
      refs.agents.textContent = String(busyColors.length);
      refs.done.textContent = String(done);
      refs.prog.style.width = `${total ? (done / total) * 100 : 0}%`;
      const label = hint || (typing ? 'Typing…' : '');
      if (refs.typing.textContent !== (label || refs.typing.textContent)) refs.typing.textContent = label;
      refs.typing.style.opacity = label ? '1' : '0';
      const key = busyColors.slice(0, MAX_AVATARS).join();
      if (key !== avatarKey) {
        avatarKey = key;
        refs.avatars.innerHTML = busyColors.slice(0, MAX_AVATARS)
          .map((c) => `<i style="width:14px;height:14px;margin-left:-5px;border-radius:50%;background:${c};border:2px solid #18181b;box-sizing:content-box"></i>`)
          .join('');
      }
    },
    finish() {
      refs.done.textContent = refs.total.textContent;
      refs.prog.style.width = '100%';
      refs.typing.textContent = 'Done';
      refs.typing.style.opacity = '1';
    },
  };
}
