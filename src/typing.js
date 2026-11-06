// 真人打字脚本：生成"打字 → 打错（重复字/颠倒/错字）→ 停顿 → 退格 → 改对"的逐帧序列
// 每一帧：{ shown: 已显示的字符串, restFrom: 原文中尚未显示部分的起点, delay: 停留毫秒 }

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const jitter = (base, a = 0.6, b = 1.5) => base * (a + Math.random() * (b - a));
const PUNCT = /[，。！？；：、,.!?;:]/;
const SPACE = /\s/;

// 按文本类型给出节奏与出错概率
export function typingProfile(len, heading) {
  if (heading) return { chunk: 1, base: 95, pTypo: 0.22, maxTypos: 2 };
  if (len < 40) return { chunk: 1, base: 55, pTypo: 0.08, maxTypos: 1 };
  return { chunk: Math.max(1, Math.ceil(len / 60)), base: 32, pTypo: 0.03, maxTypos: 2 };
}

// 打错的内容：重复上一个字（"我我"）、提前打出下一个字（颠倒）、或混入原文里的别的字
function pickMistake(chars, pos) {
  const roll = Math.random();
  if (roll < 0.5) return Array(randInt(1, 2)).fill(chars[pos - 1]);
  if (roll < 0.75 && pos + 1 < chars.length && !SPACE.test(chars[pos + 1])) return [chars[pos + 1]];
  const pool = chars.filter((c, i) => i !== pos && !SPACE.test(c) && !PUNCT.test(c));
  if (!pool.length) return [chars[pos - 1]];
  return Array.from({ length: randInt(1, 2) }, () => pool[Math.floor(Math.random() * pool.length)]);
}

export function buildTypingScript(text, heading) {
  const chars = Array.from(text);
  const n = chars.length;
  const prof = typingProfile(n, heading);
  const frames = [];
  const push = (arr, restFrom, delay) => frames.push({ shown: arr.join(''), restFrom, delay });
  let pos = 0;
  let typos = 0;

  while (pos < n) {
    const canErr = pos > 0 && typos < prof.maxTypos && !SPACE.test(chars[pos]) && !PUNCT.test(chars[pos]);
    if (canErr && Math.random() < prof.pTypo) {
      typos += 1;
      const wrong = pickMistake(chars, pos);
      let cur = chars.slice(0, pos);
      for (const w of wrong) {
        cur = [...cur, w];
        push(cur, pos, jitter(prof.base));
      }
      push(cur, pos, jitter(prof.base * 4, 0.8, 1.3));   // 发现打错，停顿
      for (let i = 0; i < wrong.length; i += 1) {
        cur = cur.slice(0, -1);
        push(cur, pos, jitter(prof.base * 0.6, 0.8, 1.2)); // 退格
      }
    }
    const next = Math.min(n, pos + prof.chunk);
    const pause = PUNCT.test(chars[next - 1]) ? prof.base * 2 : 0;
    push(chars.slice(0, next), next, jitter(prof.base) + pause);
    pos = next;
  }
  return { frames, typos };
}
