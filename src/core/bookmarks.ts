/**
 * 书签的纯逻辑。
 *
 * 书签和阅读进度共用同一套锚点：全书字符偏移。
 * 页码、章节名只是展示用的快照，位置永远以 offset 为准。
 */

import { readableImagePlaceholders } from './images';

export interface BookmarkExcerptOptions {
  /** 从这里往后取多少个字符。 */
  length?: number;
}

const DEFAULT_LENGTH = 46;

function squeeze(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim();
}

/**
 * 取书签位置的摘要：从书签所在位置往后截一段。
 * 不取「前后各一半」——那样经常把上一章的结尾也带进来，读着莫名其妙。
 */
export function makeExcerpt(
  text: string,
  offset: number,
  options: BookmarkExcerptOptions = {},
): string {
  const length = options.length ?? DEFAULT_LENGTH;
  if (!text) return '';
  const requested = Math.min(Math.max(0, Math.round(offset)), text.length);
  // 落在结尾时回退一段，避免书签摘要是空的
  const start = requested >= text.length ? Math.max(0, text.length - length) : requested;
  const end = Math.min(text.length, start + length);
  // 跳过位置前的空白，让摘要以正文开头；图片占位符显示成「[图片]」
  const snippet = squeeze(readableImagePlaceholders(text.slice(start, end)));
  if (!snippet) return '';
  return end < text.length ? `${snippet}…` : snippet;
}

/** 校验并规范化一条书签（防止手改坏 library.json）。 */
export function normalizeBookmarkOffset(offset: unknown, total: number): number {
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.round(offset)), Math.max(0, total));
}
