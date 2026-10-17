/**
 * 图片占位符：导入时把 <img> 换成一个不可见字符，正文里靠它占住字符位置。
 *
 * 这样书签、进度、搜索仍然按「第几个字」记，图片插入不会让偏移错位。
 */
export const IMAGE_PLACEHOLDER = '\uFFFC';

export function hasImagePlaceholder(text: string): boolean {
  return text.includes(IMAGE_PLACEHOLDER);
}

/** 给摘要/搜索结果用：占位符在界面上显示成「[图片]」。 */
export function readableImagePlaceholders(text: string): string {
  return text.split(IMAGE_PLACEHOLDER).join('[图片]');
}

/** 统计文本里有多少个占位符（导入时和图片数量对账）。 */
export function countImagePlaceholders(text: string): number {
  let count = 0;
  for (const char of text) if (char === IMAGE_PLACEHOLDER) count += 1;
  return count;
}

export interface OffsetEntry {
  offset: number;
}

export interface AlignOffsetsResult<T extends OffsetEntry> {
  /** 按新偏移排好序的条目。 */
  items: T[];
  /** 是否有偏移被改动（改动过就需要写回索引文件）。 */
  changed: boolean;
  /** false 表示图片数与占位符数不一致，无法安全对齐，此时不做任何改动。 */
  aligned: boolean;
  /** 被挪动的条目数量。 */
  moved: number;
}

function placeholderOffsets(text: string): number[] {
  const offsets: number[] = [];
  let index = text.indexOf(IMAGE_PLACEHOLDER);
  while (index !== -1) {
    offsets.push(index);
    index = text.indexOf(IMAGE_PLACEHOLDER, index + 1);
  }
  return offsets;
}

function indexOfOffset(sorted: readonly number[], target: number): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] === target) return mid;
    if (sorted[mid] < target) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

/** 现有偏移是否都落在占位符上（按顺序、不重复；允许比占位符少，即导入时跳过了图）。 */
function isAligned(offsets: readonly number[], placeholders: readonly number[]): boolean {
  if (offsets.length > placeholders.length) return false;
  let previous = -1;
  for (const offset of offsets) {
    const index = indexOfOffset(placeholders, offset);
    if (index < 0 || index <= previous) return false;
    previous = index;
  }
  return true;
}

/**
 * 把图片偏移对齐到正文里的占位符。
 *
 * 旧版本导入的书在清理 base64 噪声行后，正文变短了，但媒体索引没有跟着挪，
 * 表现就是所有插图都显示成「[图片]」。图片与占位符本来就是按出现顺序一一对应的
 * （导入时逐张写入），所以数量一致时按顺序重排即可精确还原；
 * 数量不一致说明导入时曾有图片被跳过（找不到文件/超过大小上限），
 * 无法判断跳过了哪一个占位符，此时宁可不改，也不能把图贴到错误的位置。
 * 新导入的书在写盘前也会跑一次，保证以后不会再错位。
 */
export function alignOffsets<T extends OffsetEntry>(
  items: readonly T[],
  text: string,
): AlignOffsetsResult<T> {
  const sorted = [...items].sort((a, b) => a.offset - b.offset);
  const placeholders = placeholderOffsets(text);
  if (sorted.length === 0) {
    return { items: sorted, changed: false, aligned: true, moved: 0 };
  }
  // 偏移都落在占位符上就不用动（比占位符少是正常的：导入时曾有图被跳过）
  if (isAligned(sorted.map((item) => item.offset), placeholders)) {
    return { items: sorted, changed: false, aligned: true, moved: 0 };
  }
  // 数量不一致时无法判断跳过了哪一个占位符，宁可不改
  if (sorted.length !== placeholders.length) {
    return { items: sorted, changed: false, aligned: false, moved: 0 };
  }

  const assigned = sorted.map((item, index) => ({ ...item, offset: placeholders[index] }));
  let moved = 0;
  for (let index = 0; index < assigned.length; index += 1) {
    if (assigned[index].offset !== sorted[index].offset) moved += 1;
  }
  return { items: assigned, changed: moved > 0, aligned: true, moved };
}
