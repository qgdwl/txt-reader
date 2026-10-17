export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function formatPercent(percent: number): string {
  const value = clamp(percent, 0, 1) * 100;
  return `${value.toFixed(1)}%`;
}

/** 由滚动容器的实际状态换算出章内比例。 */
export function scrollProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const max = scrollHeight - clientHeight;
  if (max <= 0) return 0;
  return clamp(scrollTop / max, 0, 1);
}

/** 由章内比例反推滚动位置，用于恢复阅读进度。 */
export function scrollTopForRatio(ratio: number, scrollHeight: number, clientHeight: number): number {
  const max = scrollHeight - clientHeight;
  if (max <= 0) return 0;
  return clamp(ratio, 0, 1) * max;
}
