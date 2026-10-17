/**
 * 分页相关的纯计算。
 *
 * DOM 测量（Range / caretRangeFromPoint）留在组件里，
 * 这里只做「第几个段落 + 段内第几个字 → 章节内偏移」这类可测试的换算。
 */

/** 段落数组拼接成正文时，段与段之间用一个换行分隔。 */
export const PARAGRAPH_SEPARATOR = 1;

/** 第 index 个段落、段内第 charInNode 个字符，对应章节正文里的偏移。 */
export function offsetAtNode(
  paragraphs: readonly string[],
  nodeIndex: number,
  charInNode: number,
): number {
  if (paragraphs.length === 0) return 0;
  const index = Math.min(Math.max(0, Math.trunc(nodeIndex)), paragraphs.length - 1);
  let total = 0;
  for (let i = 0; i < index; i += 1) {
    total += paragraphs[i].length + PARAGRAPH_SEPARATOR;
  }
  const limit = paragraphs[index]?.length ?? 0;
  const within = Math.min(Math.max(0, Math.trunc(charInNode)), limit);
  return total + within;
}

/** 正文总长度（含段落分隔符），用于估算页数与百分比。 */
export function paragraphsLength(paragraphs: readonly string[]): number {
  if (paragraphs.length === 0) return 0;
  let total = 0;
  for (const paragraph of paragraphs) total += paragraph.length + PARAGRAPH_SEPARATOR;
  return Math.max(0, total - PARAGRAPH_SEPARATOR);
}

/** 各章页数 → 全书总页数（没有正文的章按 0 计）。 */
export function totalPages(counts: readonly number[]): number {
  let total = 0;
  for (const count of counts) total += Math.max(0, Math.trunc(count));
  return total;
}

/** 第 chapterIndex 章之前累计的页数，用于把「本章第几页」换算成「全书第几页」。 */
export function pageOffset(counts: readonly number[], chapterIndex: number): number {
  const end = Math.min(Math.max(0, Math.trunc(chapterIndex)), counts.length);
  let total = 0;
  for (let index = 0; index < end; index += 1) total += Math.max(0, Math.trunc(counts[index]));
  return total;
}

/** 章节正文在全文中的起始偏移：chapterBody 去掉了标题行，所以要从章节末尾反推。 */
export function bodyStartOffset(chapterStart: number, chapterEnd: number, bodyLength: number): number {
  return Math.max(chapterStart, chapterEnd - bodyLength);
}

/** 绝对偏移 → 章节正文内相对偏移（可能为负，表示落在标题行上）。 */
export function relativeOffset(absoluteOffset: number, bodyStart: number): number {
  return absoluteOffset - bodyStart;
}

/**
 * 估算某一页在全书中的位置比例。页码只用于展示，
 * 真实位置始终由 pageStarts 里的偏移决定。
 */
export function estimatePageRatio(page: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  const index = Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
  return index / pageCount;
}

/**
 * 计算每一页的起始 Y（相对正文顶部）。
 *
 * 翻页位置吸附到「行的顶部」：理想断点是 pageHeight 的整数倍，
 * 但如果它正好落在某一行中间，就取那一行的开头作为下一页起点，
 * 这样页面底部永远不会出现被切掉一半的字。
 *
 * @param lineTops 所有行盒的 top（任意顺序），相对正文顶部
 * @param pageHeight 一屏的可用高度
 * @param contentHeight 正文总高度
 */
export interface LineBox {
  top: number;
  bottom: number;
}

export function buildPageOrigins(
  input: readonly LineBox[],
  pageHeight: number,
  contentHeight: number,
): number[] {
  const origins: number[] = [0];
  if (pageHeight <= 0 || contentHeight <= 0) return origins;

  const lines = [...input]
    .filter((line) => Number.isFinite(line.top) && Number.isFinite(line.bottom))
    .sort((a, b) => a.top - b.top);
  if (lines.length === 0) {
    // 没有行信息时退化为固定高度分页
    let y = 0;
    while (y + pageHeight < contentHeight - 1) {
      y += pageHeight;
      origins.push(y);
    }
    return origins;
  }

  let cursor = 0;
  // 防御性上限，避免异常数据导致死循环
  for (let guard = 0; guard < 2000; guard += 1) {
    const ideal = cursor + pageHeight;
    if (ideal >= contentHeight - 1) break;

    // 找第一行「底部越过断点」的行——它就是会被切开的那一行，整行推到下一页
    const straddling = lines.find((line) => line.bottom > ideal + 0.5);
    if (straddling === undefined) break;
    const next = straddling.top;
    if (next <= cursor + 1) break;

    origins.push(next);
    cursor = next;
  }
  return origins;
}

/** 某个 Y 落在哪一段里：返回段落索引与段内比例。 */
export function locateY(
  boxes: ReadonlyArray<{ top: number; height: number }>,
  y: number,
): { index: number; ratio: number } {
  if (boxes.length === 0) return { index: 0, ratio: 0 };
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    if (y < box.top + box.height || index === boxes.length - 1) {
      const ratio = box.height > 0 ? (y - box.top) / box.height : 0;
      return { index, ratio: Math.min(1, Math.max(0, ratio)) };
    }
  }
  return { index: boxes.length - 1, ratio: 1 };
}
