import { describe, expect, it } from 'vitest';
import { IMAGE_PLACEHOLDER as PLACEHOLDER, alignOffsets } from '../src/core/images';

function positions(text: string): number[] {
  const out: number[] = [];
  let index = text.indexOf(PLACEHOLDER);
  while (index !== -1) {
    out.push(index);
    index = text.indexOf(PLACEHOLDER, index + 1);
  }
  return out;
}

describe('alignOffsets', () => {
  it('已经对齐时不做改动', () => {
    const text = `开头${PLACEHOLDER}中间${PLACEHOLDER}结尾`;
    const offsets = positions(text);
    const items = offsets.map((offset, index) => ({ offset, file: `img-${index}.jpg` }));

    const result = alignOffsets(items, text);

    expect(result.aligned).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.moved).toBe(0);
    expect(result.items.map((item) => item.offset)).toEqual(offsets);
  });

  it('正文变短后按占位符顺序重排（带 852 张图的旧书就是这样错的）', () => {
    const text = `开头${PLACEHOLDER}中间${PLACEHOLDER}结尾${PLACEHOLDER}`;
    const offsets = positions(text);
    // 旧索引的偏移比正文大（清理噪声行后正文左移）
    const items = offsets.map((offset, index) => ({
      offset: offset + 540 + index * 90,
      file: `img-${index}.jpg`,
    }));

    const result = alignOffsets(items, text);

    expect(result.aligned).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.moved).toBe(3);
    expect(result.items.map((item) => item.offset)).toEqual(offsets);
    expect(result.items.map((item) => item.file)).toEqual([
      'img-0.jpg',
      'img-1.jpg',
      'img-2.jpg',
    ]);
  });

  it('输入顺序乱也能按偏移排序后对齐', () => {
    const text = `${PLACEHOLDER}A${PLACEHOLDER}B`;
    const offsets = positions(text);
    const items = [
      { offset: offsets[1] + 300, id: 'second' },
      { offset: offsets[0] + 300, id: 'first' },
    ];

    const result = alignOffsets(items, text);

    expect(result.items.map((item) => item.id)).toEqual(['first', 'second']);
    expect(result.items.map((item) => item.offset)).toEqual(offsets);
  });

  it('图片比占位符少、但偏移都对得上时，视为已对齐（导入时跳过图是正常的）', () => {
    const text = `${PLACEHOLDER}A${PLACEHOLDER}B${PLACEHOLDER}`;
    const offsets = positions(text);
    const items = [{ offset: offsets[0] }, { offset: offsets[2] }];

    const result = alignOffsets(items, text);

    expect(result.aligned).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.items.map((item) => item.offset)).toEqual([offsets[0], offsets[2]]);
  });

  it('数量不一致时绝不乱贴图（宁可不改）', () => {
    const text = `${PLACEHOLDER}A${PLACEHOLDER}B${PLACEHOLDER}`;
    const items = [{ offset: 1000 }, { offset: 1200 }];

    const result = alignOffsets(items, text);

    expect(result.aligned).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.items.map((item) => item.offset)).toEqual([1000, 1200]);
  });

  it('没有图片或没有占位符时安全返回', () => {
    expect(alignOffsets([], `正文${PLACEHOLDER}`)).toEqual({
      items: [],
      changed: false,
      aligned: true,
      moved: 0,
    });
    expect(alignOffsets([{ offset: 1 }], '没有图').aligned).toBe(false);
  });
});
