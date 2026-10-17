/**
 * 窗口几何与透明度计算。
 * 这些是纯函数，主进程直接用，单元测试也能覆盖边界情况。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const BOSS_DEFAULT_SIZE = { width: 440, height: 320 };
export const BOSS_MARGIN = 16;
export const BOSS_ON_SCREEN_MIN = 120;

/** 老板模式整窗透明度的默认值与范围：越小越透，桌面能透过来。 */
export const BOSS_OPACITY_DEFAULT = 0.72;
export const BOSS_OPACITY_MIN = 0.25;
export const BOSS_OPACITY_MAX = 1;

export function clampOpacity(
  value: number,
  min = BOSS_OPACITY_MIN,
  max = BOSS_OPACITY_MAX,
): number {
  if (!Number.isFinite(value)) return BOSS_OPACITY_DEFAULT;
  return Math.min(max, Math.max(min, value));
}

/** 把窗口收敛到工作区内：尺寸不超出屏幕，位置不跑到屏幕外。 */
export function clampToArea(rect: Rect, area: Rect): Rect {
  const width = Math.max(BOSS_ON_SCREEN_MIN, Math.min(rect.width, area.width));
  const height = Math.max(BOSS_ON_SCREEN_MIN, Math.min(rect.height, area.height));
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  return {
    x: Math.round(Math.min(Math.max(rect.x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(rect.y, area.y), maxY)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** 默认位置：左下角，留出边距。 */
export function bottomLeft(
  area: Rect,
  size: { width: number; height: number } = BOSS_DEFAULT_SIZE,
  margin: number = BOSS_MARGIN,
): Rect {
  return clampToArea(
    {
      x: area.x + margin,
      y: area.y + area.height - size.height - margin,
      width: size.width,
      height: size.height,
    },
    area,
  );
}

/**
 * 进入老板模式时该用的窗口矩形：
 * 有上次位置就沿用它（并收敛到当前屏幕），否则回到左下角。
 */
export function resolveBossBounds(
  area: Rect,
  saved: Rect | null | undefined,
  size: { width: number; height: number } = BOSS_DEFAULT_SIZE,
  margin: number = BOSS_MARGIN,
): Rect {
  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height) && saved.width > 0) {
    return clampToArea(saved, area);
  }
  return bottomLeft(area, size, margin);
}

/** 判断某个矩形是否还有足够部分落在屏幕内（给恢复普通窗口用）。 */
export function isMostlyVisible(rect: Rect, area: Rect): boolean {
  const left = Math.max(rect.x, area.x);
  const top = Math.max(rect.y, area.y);
  const right = Math.min(rect.x + rect.width, area.x + area.width);
  const bottom = Math.min(rect.y + rect.height, area.y + area.height);
  if (right <= left || bottom <= top) return false;
  const visible = (right - left) * (bottom - top);
  const total = rect.width * rect.height;
  return total > 0 && visible / total >= 0.5;
}

export function normalizeBounds(
  saved: Rect | null | undefined,
  area: Rect,
  fallback: Rect,
): Rect {
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return fallback;
  if (saved.width <= 0 || saved.height <= 0) return fallback;
  if (!isMostlyVisible(saved, area)) return fallback;
  return clampToArea(saved, area);
}

/**
 * 进入老板模式时真正使用的矩形。
 *
 * 历史版本可能把「整块屏幕」当成小窗位置存下来，导致只变透明、尺寸不变。
 * 这里加一道兜底：明显偏大的记录一律丢弃，回到默认左下角。
 */
export function safeBossBounds(
  area: Rect,
  saved: Rect | null | undefined,
  size: { width: number; height: number } = BOSS_DEFAULT_SIZE,
  margin: number = BOSS_MARGIN,
): Rect {
  const target = resolveBossBounds(area, saved, size, margin);
  const tooWide = target.width > area.width * 0.6;
  const tooTall = target.height > area.height * 0.6;
  return tooWide || tooTall ? bottomLeft(area, size, margin) : target;
}

/** 判断两个矩形尺寸是否足够接近（用于校验窗口是否真的缩放成功）。 */
export function sameSize(a: Rect, b: Rect, tolerance = 4): boolean {
  return Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
}
