import type { Chapter } from '../shared/types';

/**
 * 阅读位置的可信锚点：全书字符偏移。
 *
 * 页码会随字号、窗口大小变化，滚动比例会随排版变化，
 * 只有「第 N 个字符」是稳定的。页码、百分比、书签、搜索命中全部由它派生。
 */

export function clampOffset(offset: number, total: number): number {
  if (!Number.isFinite(offset) || total <= 0) return 0;
  return Math.min(Math.max(0, Math.round(offset)), total);
}

export function offsetToPercent(offset: number, total: number): number {
  if (total <= 0) return 0;
  return clampOffset(offset, total) / total;
}

export function percentToOffset(percent: number, total: number): number {
  if (total <= 0) return 0;
  const ratio = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 1) : 0;
  return Math.round(ratio * total);
}

/** 二分查找偏移所在章节；偏移落在章节边界时归入后一章。 */
export function chapterIndexAt(offset: number, chapters: readonly Chapter[]): number {
  if (chapters.length === 0) return 0;
  const target = clampOffset(offset, chapters[chapters.length - 1].end);
  let low = 0;
  let high = chapters.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (chapters[mid].start <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** 偏移在所属章节内的相对位置，0..1。 */
export function ratioWithinChapter(offset: number, chapter: Chapter): number {
  const span = chapter.end - chapter.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (offset - chapter.start) / span));
}

/** 由章节内比例反算全书偏移。 */
export function offsetFromChapterRatio(chapter: Chapter, ratio: number): number {
  const span = chapter.end - chapter.start;
  const clamped = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  return Math.round(chapter.start + span * clamped);
}

/** 旧数据（章节 + 滚动比例）迁移到偏移。 */
export interface LegacyPosition {
  chapterIndex?: number;
  scrollRatio?: number;
  offset?: number;
}

export function resolveSavedOffset(
  saved: LegacyPosition | null | undefined,
  chapters: readonly Chapter[],
  total: number,
): number {
  if (!saved) return 0;
  if (typeof saved.offset === 'number' && Number.isFinite(saved.offset)) {
    return clampOffset(saved.offset, total);
  }
  const index = typeof saved.chapterIndex === 'number' ? saved.chapterIndex : 0;
  const chapter = chapters[Math.min(Math.max(0, Math.trunc(index)), Math.max(0, chapters.length - 1))];
  if (!chapter) return 0;
  return clampOffset(offsetFromChapterRatio(chapter, saved.scrollRatio ?? 0), total);
}

/**
 * 分页用：pageStarts 是每页起始偏移（由渲染层实测得出）。
 * 用二分找出某个偏移落在第几页，保证页码和锚点永远一致。
 */
export function pageIndexForOffset(pageStarts: readonly number[], offset: number): number {
  if (pageStarts.length === 0) return 0;
  let low = 0;
  let high = pageStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (pageStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function offsetForPage(pageStarts: readonly number[], page: number): number {
  if (pageStarts.length === 0) return 0;
  const index = Math.min(Math.max(0, Math.trunc(page)), pageStarts.length - 1);
  return pageStarts[index];
}

/** 页码展示用：当前页在全书中的百分比（按页首偏移算，避免最后一页永远到不了 100%）。 */
export function pagePercent(pageStarts: readonly number[], page: number, total: number): number {
  return offsetToPercent(offsetForPage(pageStarts, page), total);
}
