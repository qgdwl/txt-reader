/**
 * 清理正文里的 base64 噪声行。
 *
 * 老版本导入时，EPUB 的版权页/水印里常夹着一串 base64（有的还会被当成正文行）。
 * 导入时已经会在提取阶段过滤；这里用于**已导入过的旧书**在打开时自动修复：
 * - 删掉这些行；
 * - 给出「旧偏移 → 新偏移」的映射，章节区间、进度、书签都能跟着挪。
 */

/** 只有 base64 字符集、长度够长的行，判定为噪声。 */
const NOISE_LINE = /^[A-Za-z0-9+/=_-]{60,}$/;

export interface RemovedRange {
  from: number;
  to: number;
}

export interface TextCleanResult {
  text: string;
  /** 被删掉的行在原文里的区间（按出现顺序）。 */
  ranges: RemovedRange[];
  /** 删掉的总字符数。 */
  removed: number;
}

export function isNoiseLine(line: string): boolean {
  return NOISE_LINE.test(line.trim());
}

export function cleanNoiseLines(text: string): TextCleanResult {
  if (!text) return { text, ranges: [], removed: 0 };
  const kept: string[] = [];
  const ranges: RemovedRange[] = [];
  let cursor = 0;
  let removed = 0;

  for (const line of text.split('\n')) {
    const start = cursor;
    const end = start + line.length;
    cursor = end + 1; // 加上换行符
    if (isNoiseLine(line)) {
      ranges.push({ from: start, to: Math.min(text.length, cursor) });
      removed += Math.min(text.length, cursor) - start;
      continue;
    }
    kept.push(line);
  }

  if (ranges.length === 0) return { text, ranges: [], removed: 0 };
  return { text: kept.join('\n'), ranges, removed };
}

/** 旧偏移 → 新偏移；落在被删区间里的偏移收拢到该区间开头。 */
export function remapOffset(offset: number, ranges: readonly RemovedRange[]): number {
  if (ranges.length === 0) return offset;
  let shift = 0;
  for (const range of ranges) {
    if (offset >= range.to) {
      shift += range.to - range.from;
      continue;
    }
    if (offset > range.from) return range.from - shift;
    break;
  }
  return offset - shift;
}
