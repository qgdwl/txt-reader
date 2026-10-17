import { describe, expect, it } from 'vitest';
import type { Chapter } from '../src/shared/types';
import {
  chapterIndexAt,
  clampOffset,
  offsetForPage,
  offsetFromChapterRatio,
  offsetToPercent,
  pageIndexForOffset,
  pagePercent,
  percentToOffset,
  ratioWithinChapter,
  resolveSavedOffset,
} from '../src/core/locator';

const chapters: Chapter[] = [
  { index: 0, title: '第一章', start: 0, end: 100 },
  { index: 1, title: '第二章', start: 100, end: 250 },
  { index: 2, title: '第三章', start: 250, end: 400 },
];
const TOTAL = 400;

describe('clampOffset', () => {
  it('收敛到 [0, total]', () => {
    expect(clampOffset(-10, TOTAL)).toBe(0);
    expect(clampOffset(9999, TOTAL)).toBe(TOTAL);
    expect(clampOffset(123.6, TOTAL)).toBe(124);
  });

  it('非法值归零', () => {
    expect(clampOffset(Number.NaN, TOTAL)).toBe(0);
    expect(clampOffset(10, 0)).toBe(0);
  });
});

describe('offsetToPercent / percentToOffset', () => {
  it('互相对应', () => {
    expect(offsetToPercent(200, TOTAL)).toBe(0.5);
    expect(percentToOffset(0.5, TOTAL)).toBe(200);
  });

  it('边界与非法值', () => {
    expect(offsetToPercent(-5, TOTAL)).toBe(0);
    expect(percentToOffset(2, TOTAL)).toBe(TOTAL);
    expect(percentToOffset(Number.NaN, TOTAL)).toBe(0);
    expect(offsetToPercent(10, 0)).toBe(0);
  });
});

describe('chapterIndexAt', () => {
  it('落在章节内部时返回该章', () => {
    expect(chapterIndexAt(50, chapters)).toBe(0);
    expect(chapterIndexAt(120, chapters)).toBe(1);
    expect(chapterIndexAt(399, chapters)).toBe(2);
  });

  it('边界偏移归入后一章', () => {
    expect(chapterIndexAt(0, chapters)).toBe(0);
    expect(chapterIndexAt(100, chapters)).toBe(1);
    expect(chapterIndexAt(250, chapters)).toBe(2);
  });

  it('超出范围被收敛', () => {
    expect(chapterIndexAt(9999, chapters)).toBe(2);
    expect(chapterIndexAt(-1, chapters)).toBe(0);
  });

  it('没有章节时返回 0', () => {
    expect(chapterIndexAt(10, [])).toBe(0);
  });
});

describe('ratioWithinChapter / offsetFromChapterRatio', () => {
  it('章内比例可往返', () => {
    const chapter = chapters[1];
    expect(ratioWithinChapter(175, chapter)).toBe(0.5);
    expect(offsetFromChapterRatio(chapter, 0.5)).toBe(175);
  });

  it('空章节不会除零', () => {
    const empty: Chapter = { index: 0, title: '空', start: 10, end: 10 };
    expect(ratioWithinChapter(10, empty)).toBe(0);
    expect(offsetFromChapterRatio(empty, 0.7)).toBe(10);
  });

  it('比例越界被收敛', () => {
    expect(offsetFromChapterRatio(chapters[0], -1)).toBe(0);
    expect(offsetFromChapterRatio(chapters[0], 5)).toBe(100);
  });
});

describe('resolveSavedOffset', () => {
  it('新数据直接用偏移', () => {
    expect(resolveSavedOffset({ offset: 123 }, chapters, TOTAL)).toBe(123);
  });

  it('旧数据按章节 + 比例换算', () => {
    expect(resolveSavedOffset({ chapterIndex: 1, scrollRatio: 0.5 }, chapters, TOTAL)).toBe(175);
  });

  it('没有记录时从零开始', () => {
    expect(resolveSavedOffset(null, chapters, TOTAL)).toBe(0);
    expect(resolveSavedOffset(undefined, chapters, TOTAL)).toBe(0);
  });

  it('章节越界时收敛到最后一章', () => {
    expect(resolveSavedOffset({ chapterIndex: 99, scrollRatio: 0 }, chapters, TOTAL)).toBe(250);
  });

  it('偏移为空但章节为 0 时回到开头', () => {
    expect(resolveSavedOffset({ chapterIndex: 0, scrollRatio: 0 }, chapters, TOTAL)).toBe(0);
  });
});

describe('分页与偏移的映射', () => {
  const pageStarts = [0, 120, 260, 340];

  it('偏移落在对应页', () => {
    expect(pageIndexForOffset(pageStarts, 0)).toBe(0);
    expect(pageIndexForOffset(pageStarts, 119)).toBe(0);
    expect(pageIndexForOffset(pageStarts, 120)).toBe(1);
    expect(pageIndexForOffset(pageStarts, 399)).toBe(3);
  });

  it('页码取页首偏移', () => {
    expect(offsetForPage(pageStarts, 2)).toBe(260);
    expect(offsetForPage(pageStarts, 99)).toBe(340);
    expect(offsetForPage(pageStarts, -3)).toBe(0);
  });

  it('空分页返回 0', () => {
    expect(pageIndexForOffset([], 10)).toBe(0);
    expect(offsetForPage([], 2)).toBe(0);
    expect(pagePercent([], 2, TOTAL)).toBe(0);
  });

  it('页码对应百分比', () => {
    expect(pagePercent(pageStarts, 0, TOTAL)).toBe(0);
    expect(pagePercent(pageStarts, 2, TOTAL)).toBeCloseTo(260 / TOTAL, 6);
  });

  it('改字号后重新分页，同一个偏移仍能定位到包含它的页', () => {
    const before = [0, 120, 260, 340];
    const after = [0, 80, 150, 210, 300, 360];
    const offset = 200;

    const pageBefore = pageIndexForOffset(before, offset);
    expect(before[pageBefore]).toBeLessThanOrEqual(offset);
    expect(before[pageBefore + 1] ?? TOTAL).toBeGreaterThan(offset);

    const pageAfter = pageIndexForOffset(after, offset);
    expect(after[pageAfter]).toBeLessThanOrEqual(offset);
    expect(after[pageAfter + 1] ?? TOTAL).toBeGreaterThan(offset);

    // 页数变了、页码变了，但偏移始终落在包含它的那一页
    expect(pageAfter).not.toBe(pageBefore);
  });
});
