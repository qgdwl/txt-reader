import { describe, expect, it } from 'vitest';
import {
  clamp,
  formatPercent,
  scrollProgress,
  scrollTopForRatio,
} from '../src/core/progress';

describe('clamp', () => {
  it('收敛到区间内', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('NaN 取最小值', () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });
});

describe('formatPercent', () => {
  it('保留一位小数', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(0.1234)).toBe('12.3%');
    expect(formatPercent(1)).toBe('100.0%');
  });

  it('越界值被收敛', () => {
    expect(formatPercent(-1)).toBe('0.0%');
    expect(formatPercent(3)).toBe('100.0%');
  });
});

describe('scrollProgress / scrollTopForRatio', () => {
  it('内容不足一屏时比例为 0', () => {
    expect(scrollProgress(0, 400, 800)).toBe(0);
  });

  it('滚动到底为 1', () => {
    expect(scrollProgress(1200, 2000, 800)).toBe(1);
  });

  it('比例与滚动位置可互相还原', () => {
    const ratio = scrollProgress(600, 2000, 800);
    expect(ratio).toBeCloseTo(0.5, 10);
    expect(scrollTopForRatio(ratio, 2000, 800)).toBeCloseTo(600, 10);
  });
});
