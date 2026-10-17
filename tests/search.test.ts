import { describe, expect, it } from 'vitest';
import type { Chapter } from '../src/shared/types';
import { searchText } from '../src/core/search';

const chapters: Chapter[] = [
  { index: 0, title: '第一章', start: 0, end: 30 },
  { index: 1, title: '第二章', start: 30, end: 60 },
];

const TEXT = '雨下了整夜，青石板路上积着水。天亮时雨停了，江面上浮着雾。他说雨会再来。';

describe('searchText', () => {
  it('找出所有命中并给出偏移', () => {
    const matches = searchText(TEXT, '雨', chapters);
    expect(matches.length).toBe(3);
    expect(matches[0].offset).toBe(0);
    expect(TEXT.slice(matches[1].offset, matches[1].offset + 1)).toBe('雨');
  });

  it('带上上下文', () => {
    const [first] = searchText(TEXT, '整夜', chapters, { context: 3 });
    expect(first.before).toBe('雨下了');
    expect(first.match).toBe('整夜');
    expect(first.after).toBe('，青石');
  });

  it('上下文不会越界', () => {
    const [first] = searchText(TEXT, '雨', chapters, { context: 99 });
    expect(first.before).toBe('');
    expect(first.after.length).toBeGreaterThan(0);
  });

  it('标记命中所在章节', () => {
    const matches = searchText(TEXT, '雨', chapters);
    expect(matches[0].chapterIndex).toBe(0);
  });

  it('英文大小写不敏感', () => {
    const matches = searchText('Chapter One and chapter two', 'CHAPTER', chapters);
    expect(matches).toHaveLength(2);
    expect(matches[0].match).toBe('Chapter');
  });

  it('空查询返回空数组', () => {
    expect(searchText(TEXT, '', chapters)).toEqual([]);
    expect(searchText(TEXT, '   ', chapters)).toEqual([]);
  });

  it('没有命中返回空数组', () => {
    expect(searchText(TEXT, '不存在的词', chapters)).toEqual([]);
  });

  it('限制返回数量', () => {
    const many = '雨'.repeat(50);
    expect(searchText(many, '雨', chapters, { limit: 5 })).toHaveLength(5);
  });

  it('命中部分不会重叠', () => {
    const matches = searchText('aaaa', 'aa', chapters);
    expect(matches.map((m) => m.offset)).toEqual([0, 2]);
  });

  it('跳过章节标题行里的命中', () => {
    const withTitle: Chapter[] = [{ index: 0, title: '第一章 渡口', start: 0, end: 40 }];
    const text = '第一章 渡口\n渡口的船工在解缆';
    const matches = searchText(text, '渡口', withTitle);
    expect(matches).toHaveLength(1);
    expect(matches[0].offset).toBe(text.lastIndexOf('渡口'));
    expect(matches[0].before).toBe('');
  });

  it('上下文不跨章节', () => {
    const chaptersWithTitle: Chapter[] = [
      { index: 0, title: '第一章', start: 0, end: 40 },
      { index: 1, title: '第二章', start: 40, end: 80 },
    ];
    const text = `第一章\n${'甲'.repeat(33)}\n第二章\n${'乙'.repeat(29)}尾`;
    const matches = searchText(text, '尾', chaptersWithTitle, { context: 5 });
    expect(matches).toHaveLength(1);
    expect(matches[0].chapterIndex).toBe(1);
    expect(matches[0].before).not.toContain('甲');
    expect(matches[0].before).not.toContain('第二章');
  });

  it('章节开头的命中不会带出标题行', () => {
    const withTitle: Chapter[] = [{ index: 0, title: '第一章', start: 0, end: 30 }];
    const text = '第一章\n雨下了一整夜';
    const [match] = searchText(text, '雨', withTitle, { context: 5 });
    expect(match.before).toBe('');
  });
});
