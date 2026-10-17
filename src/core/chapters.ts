import type { Chapter } from '../shared/types';

const NUMERALS = '0-9〇零一二三四五六七八九十百千万两';
const STRONG_HEADING = new RegExp(`^第[${NUMERALS}]{1,12}[章节回卷篇集部幕话]`);
const KEYWORD_HEADING = /^(?:序章|序言|自序|前言|引子|楔子|引言|后记|尾声|终章|结局|大结局|番外)/;
const ENGLISH_HEADING = /^chapter\s+[0-9ivxlc]+/i;

/** 章节标题最多这么长；超过就认为是正文段落。 */
export const MAX_HEADING_LENGTH = 40;
/** 首个标题之前的内容达到这个长度才单独成章（用于序言/简介）。 */
const MIN_PREFACE_LENGTH = 40;
/** 没有任何标题时，按这个字符数切块。 */
const DEFAULT_CHUNK_SIZE = 6000;

/**
 * 判断一行是不是章节标题。
 * 规则刻意保守：过长的行、带句子标点（。！？；）的行一律不算，
 * 避免把「第一章里他……」这种正文误判成标题。
 */
export function isChapterHeading(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > MAX_HEADING_LENGTH) return false;
  if (/[。！？；]/.test(text)) return false;
  if (STRONG_HEADING.test(text)) return true;
  if (KEYWORD_HEADING.test(text)) return text.length <= 30;
  if (ENGLISH_HEADING.test(text)) return true;
  return false;
}

function chunkWithoutHeadings(text: string, chunkSize: number): Chapter[] {
  if (text.length === 0) return [{ index: 0, title: '全文', start: 0, end: 0 }];
  if (text.length <= chunkSize) {
    return [{ index: 0, title: '全文', start: 0, end: text.length }];
  }
  const chapters: Chapter[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const breakAt = text.lastIndexOf('\n', end);
      // 优先在段落边界切开，但别切得过碎
      if (breakAt > start + chunkSize * 0.6) end = breakAt + 1;
    }
    chapters.push({
      index: chapters.length,
      title: `第 ${chapters.length + 1} 部分`,
      start,
      end,
    });
    start = end;
  }
  return chapters;
}

export interface SplitOptions {
  chunkSize?: number;
  minPrefaceLength?: number;
}

/**
 * 把全文切成章节。返回值保证：区间连续、左闭右开、覆盖 [0, text.length)。
 */
export function splitChapters(text: string, options: SplitOptions = {}): Chapter[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const minPreface = options.minPrefaceLength ?? MIN_PREFACE_LENGTH;

  const headings: Array<{ title: string; start: number }> = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    if (isChapterHeading(line)) headings.push({ title: line.trim(), start: offset });
    offset += line.length + 1;
  }

  if (headings.length === 0) return chunkWithoutHeadings(text, chunkSize);

  const chapters: Chapter[] = [];
  const firstStart = headings[0].start;
  // 前言太短就不单独成章，但要把它并进第一章，否则这段文字不属于任何章节
  const hasPreface = text.slice(0, firstStart).trim().length >= minPreface;
  if (hasPreface) {
    chapters.push({ index: 0, title: '开始', start: 0, end: firstStart });
  }

  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const next = headings[i + 1];
    chapters.push({
      index: chapters.length,
      title: heading.title,
      start: i === 0 && !hasPreface ? 0 : heading.start,
      end: next ? next.start : text.length,
    });
  }

  return chapters;
}

/**
 * 取章节正文。若正文首行就是标题本身，则去掉它——标题已经在阅读界面顶部展示过了。
 */
export function chapterBody(text: string, chapter: Chapter): string {
  const slice = text.slice(chapter.start, chapter.end);
  const breakAt = slice.indexOf('\n');
  const firstLine = breakAt === -1 ? slice : slice.slice(0, breakAt);
  if (firstLine.trim() === chapter.title) {
    return breakAt === -1 ? '' : slice.slice(breakAt + 1);
  }
  return slice;
}

/** 章内是否有能显示的文字。EPUB 的封面/图片页只有标题，正文为空。 */
export function chapterHasBody(text: string, chapter: Chapter): boolean {
  return chapterBody(text, chapter).trim().length > 0;
}

/**
 * 从 from 往 dir 方向找第一个有正文的章节；
 * 找不到返回 -1。用于跳过「只有标题、没有正文」的空章节，避免翻到空白页。
 */
export function nearestChapterWithBody(
  text: string,
  chapters: readonly Chapter[],
  from: number,
  dir: 1 | -1,
): number {
  for (let i = from + dir; i >= 0 && i < chapters.length; i += dir) {
    if (chapterHasBody(text, chapters[i])) return i;
  }
  return -1;
}
