import { describe, expect, it } from 'vitest';
import {
  bodyStartOffset,
  buildPageOrigins,
  estimatePageRatio,
  locateY,
  offsetAtNode,
  pageOffset,
  paragraphsLength,
  relativeOffset,
  totalPages,
} from '../src/core/paging';

const paragraphs = ['第一段', '第二段更长的内容', '第三段'];

describe('offsetAtNode', () => {
  it('第一个段落开头是 0', () => {
    expect(offsetAtNode(paragraphs, 0, 0)).toBe(0);
  });

  it('段落之间有分隔符', () => {
    // '第一段' 长度 3，加一个换行 = 4
    expect(offsetAtNode(paragraphs, 1, 0)).toBe(4);
    expect(offsetAtNode(paragraphs, 2, 0)).toBe(4 + '第二段更长的内容'.length + 1);
  });

  it('段内偏移被截断到段长', () => {
    expect(offsetAtNode(paragraphs, 1, 999)).toBe(4 + 8);
    expect(offsetAtNode(paragraphs, 1, -5)).toBe(4);
  });

  it('节点索引越界时收敛到最后一个段落', () => {
    const last = 4 + 8 + 1;
    expect(offsetAtNode(paragraphs, 99, 0)).toBe(last);
  });

  it('空段落数组返回 0', () => {
    expect(offsetAtNode([], 0, 0)).toBe(0);
  });
});

describe('paragraphsLength', () => {
  it('等于段落拼接后的长度', () => {
    expect(paragraphsLength(paragraphs)).toBe(paragraphs.join('\n').length);
  });

  it('空数组为 0', () => {
    expect(paragraphsLength([])).toBe(0);
  });
});

describe('totalPages', () => {
  it('各章页数求和，空章节按 0 计', () => {
    expect(totalPages([12, 0, 8])).toBe(20);
    expect(totalPages([])).toBe(0);
  });

  it('负数与小数不会污染总数', () => {
    expect(totalPages([-3, 4.9, 2])).toBe(6);
  });
});

describe('pageOffset', () => {
  const counts = [12, 0, 8, 5];

  it('返回前面各章页数之和', () => {
    expect(pageOffset(counts, 0)).toBe(0);
    expect(pageOffset(counts, 1)).toBe(12);
    expect(pageOffset(counts, 3)).toBe(20);
  });

  it('越界时收敛到两端', () => {
    expect(pageOffset(counts, -2)).toBe(0);
    expect(pageOffset(counts, 99)).toBe(25);
  });
});

describe('bodyStartOffset', () => {
  it('正文是章节的尾部时反推起点', () => {
    // 章节 [0,10)，正文 6 个字 → 起点 4（前面是标题行）
    expect(bodyStartOffset(0, 10, 6)).toBe(4);
  });

  it('正文等于整章时起点就是章节起点', () => {
    expect(bodyStartOffset(100, 150, 50)).toBe(100);
  });

  it('正文比章节还长时不返回负数起点', () => {
    expect(bodyStartOffset(100, 150, 200)).toBe(100);
  });
});

describe('relativeOffset', () => {
  it('绝对偏移减去正文起点', () => {
    expect(relativeOffset(120, 100)).toBe(20);
    expect(relativeOffset(90, 100)).toBe(-10);
  });
});

describe('estimatePageRatio', () => {
  it('按页码估算比例', () => {
    expect(estimatePageRatio(0, 4)).toBe(0);
    expect(estimatePageRatio(2, 4)).toBe(0.5);
    expect(estimatePageRatio(99, 4)).toBe(0.75);
  });

  it('页数为 0 时返回 0', () => {
    expect(estimatePageRatio(3, 0)).toBe(0);
  });
});

describe('buildPageOrigins', () => {
  // 每 20px 一行，共 100 行 → 内容高 2000
  const lines = Array.from({ length: 100 }, (_, i) => ({ top: i * 20, bottom: i * 20 + 20 }));

  it('断点落在行中间时吸附到下一行开头', () => {
    const origins = buildPageOrigins(lines, 210, 2000);
    expect(origins[0]).toBe(0);
    // 理想断点 210 落在 200~220 这行中间 → 整行推到下页，从 200 开始
    expect(origins[1]).toBe(200);
  });

  it('断点正好在行首时直接用', () => {
    const origins = buildPageOrigins(lines, 200, 2000);
    expect(origins[1]).toBe(200);
  });

  it('每页起点都严格递增', () => {
    const origins = buildPageOrigins(lines, 217, 2000);
    for (let i = 1; i < origins.length; i += 1) {
      expect(origins[i]).toBeGreaterThan(origins[i - 1]);
    }
  });

  it('没有行信息时退化为固定高度', () => {
    expect(buildPageOrigins([], 500, 2000)).toEqual([0, 500, 1000, 1500]);
  });

  it('内容不足一屏时只有一页', () => {
    expect(buildPageOrigins(lines.slice(0, 3), 500, 60)).toEqual([0]);
  });

  it('异常数据不会死循环', () => {
    const bad = [{ top: 0, bottom: 0 }, { top: 0, bottom: 0 }, { top: Number.NaN, bottom: 1 }];
    const origins = buildPageOrigins(bad, 100, 10000);
    expect(origins.length).toBeLessThan(10);
  });
});

describe('locateY', () => {
  const boxes = [
    { top: 0, height: 100 },
    { top: 100, height: 50 },
  ];

  it('定位到对应段落并算出比例', () => {
    expect(locateY(boxes, 50)).toEqual({ index: 0, ratio: 0.5 });
    expect(locateY(boxes, 125)).toEqual({ index: 1, ratio: 0.5 });
  });

  it('超出范围时落到最后一段', () => {
    expect(locateY(boxes, 999)).toEqual({ index: 1, ratio: 1 });
  });

  it('空数组安全返回', () => {
    expect(locateY([], 10)).toEqual({ index: 0, ratio: 0 });
  });
});
