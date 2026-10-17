import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_SCALE,
  clampPage,
  fitPageSize,
  looksLikePdf,
  pdfPageFromProgress,
  pdfPageLabel,
  pdfPercent,
} from '../src/core/pdf';

describe('clampPage', () => {
  it('把页码收敛到 0..pageCount-1', () => {
    expect(clampPage(-3, 10)).toBe(0);
    expect(clampPage(0, 10)).toBe(0);
    expect(clampPage(4, 10)).toBe(4);
    expect(clampPage(10, 10)).toBe(9);
    expect(clampPage(99, 10)).toBe(9);
  });

  it('小数向零取整，NaN 回到第一页', () => {
    expect(clampPage(3.9, 10)).toBe(3);
    expect(clampPage(Number.NaN, 10)).toBe(0);
    expect(clampPage(Number.POSITIVE_INFINITY, 10)).toBe(9);
  });

  it('页数为 0 或非法时固定第 0 页', () => {
    expect(clampPage(5, 0)).toBe(0);
    expect(clampPage(5, -1)).toBe(0);
    expect(clampPage(5, Number.NaN)).toBe(0);
  });
});

describe('pdfPercent', () => {
  it('第一页不是 0%，最后一页正好 100%', () => {
    expect(pdfPercent(0, 4)).toBeCloseTo(0.25, 6);
    expect(pdfPercent(1, 4)).toBeCloseTo(0.5, 6);
    expect(pdfPercent(3, 4)).toBeCloseTo(1, 6);
  });

  it('越界与空页数有确定结果', () => {
    expect(pdfPercent(99, 4)).toBeCloseTo(1, 6);
    expect(pdfPercent(-2, 4)).toBeCloseTo(0.25, 6);
    expect(pdfPercent(2, 0)).toBe(0);
  });
});

describe('pdfPageLabel', () => {
  it('按 1 基展示页码', () => {
    expect(pdfPageLabel(0, 12)).toBe('第 1 / 12 页');
    expect(pdfPageLabel(11, 12)).toBe('第 12 / 12 页');
  });

  it('页数未知时不显示假页码', () => {
    expect(pdfPageLabel(0, 0)).toBe('第 0 / 0 页');
    expect(pdfPageLabel(5, Number.NaN)).toBe('第 0 / 0 页');
  });
});

describe('pdfPageFromProgress', () => {
  it('存档里的 offset 就是页码', () => {
    expect(pdfPageFromProgress({ offset: 7 }, 20)).toBe(7);
    expect(pdfPageFromProgress({ offset: 999 }, 20)).toBe(19);
  });

  it('没有存档或非法值回到第一页', () => {
    expect(pdfPageFromProgress(null, 20)).toBe(0);
    expect(pdfPageFromProgress({}, 20)).toBe(0);
    expect(pdfPageFromProgress({ offset: Number.NaN }, 20)).toBe(0);
  });

  it('兼容老存档的章节/比例字段（PDF 不使用，按第一页处理）', () => {
    expect(pdfPageFromProgress({ chapterIndex: 3, scrollRatio: 0.5 }, 20)).toBe(0);
  });
});

describe('fitPageSize', () => {
  it('A4 竖版在 16:9 屏幕里按高度自适应并保持比例', () => {
    const fit = fitPageSize(595, 842, 1600, 900);
    expect(fit.height).toBe(900);
    expect(fit.width).toBe(Math.floor((595 * fit.scale)));
    expect(fit.width / fit.height).toBeCloseTo(595 / 842, 2);
  });

  it('宽页面按宽度自适应', () => {
    const fit = fitPageSize(1600, 900, 800, 1000);
    expect(fit.width).toBe(800);
    expect(fit.height).toBe(450);
  });

  it('小页面放大有上限，不铺出巨大的画布', () => {
    const fit = fitPageSize(100, 100, 4000, 4000);
    expect(fit.scale).toBeCloseTo(MAX_PAGE_SCALE, 6);
    expect(fit.width).toBe(400);
    expect(fit.height).toBe(400);
  });

  it('非法尺寸返回 0，调用方据此跳过渲染', () => {
    expect(fitPageSize(0, 100, 800, 600)).toEqual({ width: 0, height: 0, scale: 0 });
    expect(fitPageSize(100, 100, 0, 600)).toEqual({ width: 0, height: 0, scale: 0 });
    expect(fitPageSize(Number.NaN, 100, 800, 600)).toEqual({ width: 0, height: 0, scale: 0 });
  });

  it('可用区域比页面略小时仍然至少给 1px，避免 display:none 式的空白', () => {
    const fit = fitPageSize(595, 842, 1, 1);
    expect(fit.width).toBeGreaterThanOrEqual(1);
    expect(fit.height).toBeGreaterThanOrEqual(1);
  });
});

describe('looksLikePdf', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it('识别标准文件头', () => {
    expect(looksLikePdf(encode('%PDF-1.7\n...'))).toBe(true);
  });

  it('允许文件头前有少量垃圾字节', () => {
    expect(looksLikePdf(encode('乱码前缀\n%PDF-1.4\n'))).toBe(true);
  });

  it('不是 PDF 的字节返回 false', () => {
    expect(looksLikePdf(encode('这是一本 TXT'))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
    expect(looksLikePdf(encode('%PD'))).toBe(false);
  });

  it('只在开头 1024 字节内查找，避免把正文里的 %PDF- 当成文件头', () => {
    const prefix = new Uint8Array(1100).fill(0x20);
    const bytes = new Uint8Array(prefix.length + 8);
    bytes.set(prefix, 0);
    bytes.set(encode('%PDF-1.4'), 1100);
    expect(looksLikePdf(bytes)).toBe(false);
  });
});
