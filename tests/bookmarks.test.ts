import { describe, expect, it } from 'vitest';
import { makeExcerpt, normalizeBookmarkOffset } from '../src/core/bookmarks';

const TEXT = '第一章开头。雨下了整夜，青石板路上积着水，倒映出街口那盏将要熄灭的灯笼。陈渡把伞收起来。';

describe('makeExcerpt', () => {
  it('从书签位置往后截取', () => {
    const offset = TEXT.indexOf('雨下了整夜');
    expect(makeExcerpt(TEXT, offset, { length: 5 })).toBe('雨下了整夜…');
  });

  it('不带上书签之前的内容', () => {
    const offset = TEXT.indexOf('陈渡');
    expect(makeExcerpt(TEXT, offset, { length: 6 })).toBe('陈渡把伞收起…');
  });

  it('截到末尾时不加省略号', () => {
    const offset = TEXT.length - 4;
    expect(makeExcerpt(TEXT, offset, { length: 99 }).endsWith('…')).toBe(false);
  });

  it('压缩空白', () => {
    expect(makeExcerpt('a\n\nb   c', 0, { length: 99 })).toBe('a b c');
  });

  it('空文本返回空串', () => {
    expect(makeExcerpt('', 10)).toBe('');
  });

  it('偏移越界被收敛', () => {
    expect(makeExcerpt('短文本', 999)).toBe('短文本');
    expect(makeExcerpt('短文本', -5, { length: 2 })).toBe('短文…');
  });
});

describe('normalizeBookmarkOffset', () => {
  it('收敛到 [0, total]', () => {
    expect(normalizeBookmarkOffset(-5, 100)).toBe(0);
    expect(normalizeBookmarkOffset(500, 100)).toBe(100);
    expect(normalizeBookmarkOffset(12.6, 100)).toBe(13);
  });

  it('非法值归零', () => {
    expect(normalizeBookmarkOffset(Number.NaN, 100)).toBe(0);
    expect(normalizeBookmarkOffset('12', 100)).toBe(0);
  });
});
