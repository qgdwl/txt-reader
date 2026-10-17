import { describe, expect, it } from 'vitest';
import {
  BOSS_DEFAULT_SIZE,
  BOSS_MARGIN,
  BOSS_ON_SCREEN_MIN,
  BOSS_OPACITY_DEFAULT,
  bottomLeft,
  clampOpacity,
  clampToArea,
  isMostlyVisible,
  normalizeBounds,
  resolveBossBounds,
} from '../src/core/window';

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const areaWithOffset = { x: 100, y: 50, width: 1280, height: 720 };

describe('clampOpacity', () => {
  it('收敛到允许区间', () => {
    expect(clampOpacity(0.1)).toBe(0.25);
    expect(clampOpacity(-1)).toBe(0.25);
    expect(clampOpacity(5)).toBe(1);
    expect(clampOpacity(0.6)).toBe(0.6);
  });

  it('非法值回退到默认档', () => {
    expect(clampOpacity(Number.NaN)).toBe(BOSS_OPACITY_DEFAULT);
  });
});

describe('clampToArea', () => {
  it('超出右边和底边时被拉回', () => {
    const rect = clampToArea({ x: 1800, y: 1000, width: 400, height: 300 }, area);
    expect(rect.x).toBe(area.width - 400);
    expect(rect.y).toBe(area.height - 300);
  });

  it('超出左边和上边时被拉回', () => {
    const rect = clampToArea({ x: -500, y: -500, width: 400, height: 300 }, area);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });

  it('尺寸大于屏幕时被限制', () => {
    const rect = clampToArea({ x: 0, y: 0, width: 5000, height: 5000 }, area);
    expect(rect.width).toBe(area.width);
    expect(rect.height).toBe(area.height);
  });

  it('尺度过小时保留最小可用尺寸', () => {
    const rect = clampToArea({ x: 10, y: 10, width: 10, height: 10 }, area);
    expect(rect.width).toBe(BOSS_ON_SCREEN_MIN);
    expect(rect.height).toBe(BOSS_ON_SCREEN_MIN);
  });

  it('支持带偏移的工作区（多显示器）', () => {
    const rect = clampToArea({ x: 0, y: 0, width: 400, height: 300 }, areaWithOffset);
    expect(rect.x).toBe(areaWithOffset.x);
    expect(rect.y).toBe(areaWithOffset.y);
  });
});

describe('bottomLeft', () => {
  it('贴在左下角并留出边距', () => {
    const rect = bottomLeft(area);
    expect(rect.width).toBe(BOSS_DEFAULT_SIZE.width);
    expect(rect.height).toBe(BOSS_DEFAULT_SIZE.height);
    expect(rect.x).toBe(area.x + BOSS_MARGIN);
    expect(rect.y).toBe(area.y + area.height - BOSS_DEFAULT_SIZE.height - BOSS_MARGIN);
  });

  it('屏幕比窗口还小时不会跑出屏幕', () => {
    const small = { x: 0, y: 0, width: 300, height: 200 };
    const rect = bottomLeft(small);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(300);
  });
});

describe('resolveBossBounds', () => {
  it('没有历史位置时用左下角', () => {
    expect(resolveBossBounds(area, null)).toEqual(bottomLeft(area));
  });

  it('有历史位置时沿用并收敛', () => {
    const saved = { x: 500, y: 200, width: 440, height: 320 };
    expect(resolveBossBounds(area, saved)).toEqual(saved);

    const offscreen = { x: 9000, y: 9000, width: 440, height: 320 };
    const fixed = resolveBossBounds(area, offscreen);
    expect(fixed.x).toBe(area.width - 440);
    expect(fixed.y).toBe(area.height - 320);
  });

  it('历史位置尺寸非法时回退到默认', () => {
    const broken = { x: 100, y: 100, width: 0, height: Number.NaN };
    expect(resolveBossBounds(area, broken)).toEqual(bottomLeft(area));
  });
});

describe('isMostlyVisible', () => {
  it('完全在屏幕内为真', () => {
    expect(isMostlyVisible({ x: 100, y: 100, width: 400, height: 300 }, area)).toBe(true);
  });

  it('大部分在屏幕外为假', () => {
    expect(isMostlyVisible({ x: 1900, y: 100, width: 400, height: 300 }, area)).toBe(false);
  });
});

describe('normalizeBounds', () => {
  const fallback = { x: 0, y: 0, width: 1240, height: 860 };

  it('没有记录时用默认窗口', () => {
    expect(normalizeBounds(null, area, fallback)).toEqual(fallback);
  });

  it('记录可用时沿用', () => {
    const saved = { x: 200, y: 120, width: 1000, height: 700 };
    expect(normalizeBounds(saved, area, fallback)).toEqual(saved);
  });

  it('记录跑到屏幕外时回退', () => {
    const saved = { x: 3000, y: 2000, width: 1000, height: 700 };
    expect(normalizeBounds(saved, area, fallback)).toEqual(fallback);
  });
});
