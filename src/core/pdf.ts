import type { ReadingPosition } from '../shared/types';

/**
 * PDF 的纯逻辑：页码换算、适配缩放、文件魔数判断。
 *
 * PDF 没有「字符偏移」这个概念，位置锚点直接就是页码（0 基）。
 * 这些函数不碰 DOM，渲染层只负责把结果画出来，方便单测。
 */

/** 页面最多放大到多少倍：小页面（如单行 PDF）不放到铺满整屏，避免无谓的大画布。 */
export const MAX_PAGE_SCALE = 4;

/** 页码越界收敛：0 基，非法值一律回到第一页。 */
export function clampPage(page: number, pageCount: number): number {
  const total = Number.isFinite(pageCount) ? Math.trunc(pageCount) : 0;
  if (total <= 0) return 0;
  if (Number.isNaN(page)) return 0;
  // Infinity 会被夹到最后一页，-Infinity 夹到第一页
  return Math.min(Math.max(0, Math.trunc(page)), total - 1);
}

/** 阅读百分比：按「已读到第几页 / 总页数」算，最后一页正好 100%。 */
export function pdfPercent(page: number, pageCount: number): number {
  const total = Number.isFinite(pageCount) ? Math.trunc(pageCount) : 0;
  if (total <= 0) return 0;
  return (clampPage(page, total) + 1) / total;
}

/** 页脚展示用的「第 N / M 页」。 */
export function pdfPageLabel(page: number, pageCount: number): string {
  const total = Number.isFinite(pageCount) ? Math.max(0, Math.trunc(pageCount)) : 0;
  const index = clampPage(page, total);
  return `第 ${total > 0 ? index + 1 : 0} / ${total} 页`;
}

/** 存档位置 → 页码。老存档没有 offset 或不是 PDF 时回到第一页。 */
export function pdfPageFromProgress(
  position: ReadingPosition | null | undefined,
  pageCount: number,
): number {
  const raw = position?.offset;
  return clampPage(typeof raw === 'number' && Number.isFinite(raw) ? raw : 0, pageCount);
}

export interface PageFit {
  /** 页面在屏幕上的 CSS 宽高。 */
  width: number;
  height: number;
  /** 页面尺寸到屏幕尺寸的缩放倍率。 */
  scale: number;
}

/**
 * 一页一屏：把整页按比例塞进可用区域（contain，不裁切），
 * 同时限制最大放大倍率与最小倍率，避免退化成 0 尺寸。
 */
export function fitPageSize(
  pageWidth: number,
  pageHeight: number,
  boxWidth: number,
  boxHeight: number,
  maxScale: number = MAX_PAGE_SCALE,
): PageFit {
  if (
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    !Number.isFinite(boxWidth) ||
    !Number.isFinite(boxHeight) ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    boxWidth <= 0 ||
    boxHeight <= 0
  ) {
    return { width: 0, height: 0, scale: 0 };
  }
  const limit = Number.isFinite(maxScale) && maxScale > 0 ? maxScale : MAX_PAGE_SCALE;
  const scale = Math.min(Math.max(Math.min(boxWidth / pageWidth, boxHeight / pageHeight), 0.01), limit);
  return {
    width: Math.max(1, Math.floor(pageWidth * scale)),
    height: Math.max(1, Math.floor(pageHeight * scale)),
    scale,
  };
}

/**
 * 判断字节是不是 PDF：规范允许文件头前有少量垃圾字节，
 * 所以在前 1024 字节里找 `%PDF-`，而不是只比较开头。
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 5) return false;
  const limit = Math.min(bytes.length, 1024);
  for (let index = 0; index <= limit - 5; index += 1) {
    if (
      bytes[index] === 0x25 && // %
      bytes[index + 1] === 0x50 && // P
      bytes[index + 2] === 0x44 && // D
      bytes[index + 3] === 0x46 && // F
      bytes[index + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}
