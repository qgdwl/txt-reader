import { describe, expect, it } from 'vitest';
import { detectAuthorFromText, parseFileName, resolveBookMeta } from '../src/core/metadata';

describe('parseFileName', () => {
  it('解析《书名》作者', () => {
    expect(parseFileName('《斗破苍穹》天蚕土豆.txt')).toEqual({
      title: '斗破苍穹',
      author: '天蚕土豆',
    });
  });

  it('只有《书名》', () => {
    expect(parseFileName('《三体》.txt')).toEqual({ title: '三体', author: '' });
  });

  it('解析 书名(作者)', () => {
    expect(parseFileName('凡人修仙传(忘语).txt')).toEqual({
      title: '凡人修仙传',
      author: '忘语',
    });
  });

  it('解析 by 形式', () => {
    expect(parseFileName('深夜书屋 by 张三.txt')).toEqual({ title: '深夜书屋', author: '张三' });
  });

  it('去掉【完结】这类装饰', () => {
    expect(parseFileName('【完结】诡秘之主.txt')).toEqual({ title: '诡秘之主', author: '' });
  });

  it('去掉「作者：」前缀', () => {
    expect(parseFileName('《活着》作者：余华.txt')).toEqual({ title: '活着', author: '余华' });
  });

  it('没有可用信息时整名当书名', () => {
    expect(parseFileName('随手记.txt')).toEqual({ title: '随手记', author: '' });
  });

  it('没有扩展名也能处理', () => {
    expect(parseFileName('无扩展名')).toEqual({ title: '无扩展名', author: '' });
  });

  it('括号里是纯数字时不当作作者', () => {
    expect(parseFileName('第3卷(1).txt')).toEqual({ title: '第3卷(1)', author: '' });
  });

  it('空文件名回退为未命名', () => {
    expect(parseFileName('.txt').title).toBe('未命名');
  });
});

describe('detectAuthorFromText', () => {
  it('从前几行找作者', () => {
    expect(detectAuthorFromText('《三体》\n作者：刘慈欣\n\n第一章')).toBe('刘慈欣');
  });

  it('没有作者信息时返回空串', () => {
    expect(detectAuthorFromText('第一章 开始\n正文')).toBe('');
  });

  it('只看前 4000 字', () => {
    const text = `${'占位'.repeat(3000)}\n作者：后置作者`;
    expect(detectAuthorFromText(text)).toBe('');
  });
});

describe('resolveBookMeta', () => {
  it('文件名给出作者时不再看正文', () => {
    expect(resolveBookMeta('《活着》余华.txt', '作者：别人')).toEqual({
      title: '活着',
      author: '余华',
    });
  });

  it('文件名没作者时从正文补齐', () => {
    expect(resolveBookMeta('三体.txt', '作者：刘慈欣\n第一章')).toEqual({
      title: '三体',
      author: '刘慈欣',
    });
  });
});
