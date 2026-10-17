import type { Chapter } from '../shared/types';
import { chapterIndexAt } from './locator';

/**
 * 书内搜索：命中位置直接给字符偏移，和书签、进度共用同一套锚点，
 * 所以点搜索结果能精确跳到那一页，改字号也不会错位。
 */

export interface SearchMatch {
  /** 命中处在全文中的字符偏移。 */
  offset: number;
  chapterIndex: number;
  /** 命中前后的上下文（已去掉首尾空白）。 */
  before: string;
  match: string;
  after: string;
}

export interface SearchOptions {
  limit?: number;
  context?: number;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_CONTEXT = 18;

export function searchText(
  text: string,
  query: string,
  chapters: readonly Chapter[],
  options: SearchOptions = {},
): SearchMatch[] {
  const needle = query.trim();
  if (!needle || !text) return [];

  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const context = Math.max(0, options.context ?? DEFAULT_CONTEXT);
  const haystack = text.toLowerCase();
  const lower = needle.toLowerCase();
  const matches: SearchMatch[] = [];

  let cursor = 0;
  while (matches.length < limit) {
    const at = haystack.indexOf(lower, cursor);
    if (at === -1) break;

    const chapterIndex = chapterIndexAt(at, chapters);
    const chapter = chapters[chapterIndex];

    // 上下文不跨章节，否则会把下/上一章的标题一起显示出来
    const chapterStart = chapter?.start ?? 0;
    const chapterEnd = chapter?.end ?? text.length;

    // 章节首行是标题，目录里已经有了；跳过它的命中，避免上下文出现半截标题
    // 章节首行是标题（标题后必须还有换行才算），目录里已经有了；
    // 跳过标题行里的命中，避免上下文出现半截标题
    const newline = text.indexOf('\n', chapterStart);
    if (newline !== -1 && newline < chapterEnd && at < newline) {
      cursor = at + Math.max(1, needle.length);
      continue;
    }

    const from = Math.max(chapterStart, at - context);
    const to = Math.min(chapterEnd, at + needle.length + context);

    let before = text.slice(from, at);
    if (from <= chapterStart) {
      // 章节正文以「标题行 + 换行」开头，去掉标题；没有换行说明整章只有一行，不动
      before = before.replace(/^[^\n]*\n/, '');
    }

    matches.push({
      offset: at,
      chapterIndex,
      before: before.replace(/^\s+/, ''),
      match: text.slice(at, at + needle.length),
      after: text.slice(at + needle.length, to).replace(/\s+$/, ''),
    });

    cursor = at + Math.max(1, needle.length);
  }

  return matches;
}
