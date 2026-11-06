// 速度 → 动作时长倍数。用户看到的 speed 越大越快；内部各动作时长乘以 pace，pace 越小越快。
// speed = 1 对应 v0.3.0 的默认节奏（当时的时长倍数 0.7）。

export const BASE_PACE = 0.7;
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;

export function durationScale(speed) {
  const n = Number(speed);
  const s = Number.isFinite(n) && n > 0 ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, n)) : 1;
  return BASE_PACE / s;
}
