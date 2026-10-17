import { describe, expect, it } from 'vitest';
import type { ReadingSession } from '../src/core/stats';
import { charsPerMinute, dayKey, formatDuration, summarize } from '../src/core/stats';

const NOW = new Date(2026, 4, 20, 21, 0, 0).getTime();
const DAY = 86400000;

function session(daysAgo: number, seconds: number, bookId = 'b1'): ReadingSession {
  return { bookId, startedAt: NOW - daysAgo * DAY, seconds };
}

describe('dayKey', () => {
  it('按本地时区生成日期键', () => {
    expect(dayKey(NOW)).toBe('2026-05-20');
  });

  it('补零', () => {
    expect(dayKey(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
  });
});

describe('summarize', () => {
  it('没有记录时全为 0', () => {
    const summary = summarize([], NOW);
    expect(summary.totalSeconds).toBe(0);
    expect(summary.todaySeconds).toBe(0);
    expect(summary.activeDays).toBe(0);
    expect(summary.lastDays).toHaveLength(7);
  });

  it('累加今天与总计', () => {
    const summary = summarize([session(0, 600), session(0, 300), session(1, 1200)], NOW);
    expect(summary.todaySeconds).toBe(900);
    expect(summary.totalSeconds).toBe(2100);
    expect(summary.sessionCount).toBe(3);
  });

  it('统计有阅读的天数', () => {
    const summary = summarize([session(0, 60), session(1, 60), session(1, 30), session(3, 60)], NOW);
    expect(summary.activeDays).toBe(3);
  });

  it('最近 7 天按时间正序，最后一个 是今天', () => {
    const summary = summarize([session(0, 60), session(6, 120), session(9, 999)], NOW);
    expect(summary.lastDays).toHaveLength(7);
    expect(summary.lastDays[6].date).toBe('2026-05-20');
    expect(summary.lastDays[6].seconds).toBe(60);
    expect(summary.lastDays[0].seconds).toBe(120);
    // 第 9 天前的记录不进 7 天窗口，但仍计入总计
    expect(summary.totalSeconds).toBe(1179);
  });

  it('忽略非法与零时长记录', () => {
    const bad = [
      { bookId: 'b1', startedAt: NOW, seconds: 0 },
      { bookId: 'b1', startedAt: NOW, seconds: Number.NaN },
      { bookId: 'b1', startedAt: Number.NaN, seconds: 30 },
    ];
    expect(summarize(bad, NOW).sessionCount).toBe(0);
  });

  it('可自定义窗口天数', () => {
    expect(summarize([], NOW, 3).lastDays).toHaveLength(3);
    expect(summarize([], NOW, 0).lastDays).toHaveLength(1);
  });
});

describe('formatDuration', () => {
  it('分秒小时都有人话', () => {
    expect(formatDuration(0)).toBe('0 秒');
    expect(formatDuration(45)).toBe('45 秒');
    expect(formatDuration(600)).toBe('10 分钟');
    expect(formatDuration(3600)).toBe('1 小时');
    expect(formatDuration(3600 + 23 * 60)).toBe('1 小时 23 分');
  });

  it('负数归零', () => {
    expect(formatDuration(-10)).toBe('0 秒');
  });
});

describe('charsPerMinute', () => {
  it('按字数与时长换算', () => {
    expect(charsPerMinute(600, 60)).toBe(600);
    expect(charsPerMinute(300, 120)).toBe(150);
  });

  it('没有时长时返回 0', () => {
    expect(charsPerMinute(100, 0)).toBe(0);
    expect(charsPerMinute(100, Number.NaN)).toBe(0);
  });
});
