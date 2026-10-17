import { describe, expect, it } from 'vitest';
import {
  chapterBody,
  chapterHasBody,
  isChapterHeading,
  nearestChapterWithBody,
  splitChapters,
} from '../src/core/chapters';

describe('isChapterHeading', () => {
  it('识别常见中文章节标题', () => {
    expect(isChapterHeading('第一章 开始')).toBe(true);
    expect(isChapterHeading('第十二回 风波')).toBe(true);
    expect(isChapterHeading('第三卷 落幕')).toBe(true);
    expect(isChapterHeading('第一章')).toBe(true);
  });

  it('识别序章类标题', () => {
    expect(isChapterHeading('楔子')).toBe(true);
    expect(isChapterHeading('序章 旧事')).toBe(true);
    expect(isChapterHeading('番外一')).toBe(true);
  });

  it('识别英文章节', () => {
    expect(isChapterHeading('Chapter 1')).toBe(true);
    expect(isChapterHeading('chapter 12 - the end')).toBe(true);
  });

  it('不把正文句子当成标题', () => {
    expect(isChapterHeading('第一章里他遇见了她，从此人生不同。')).toBe(false);
    expect(isChapterHeading('他说：第一章写完了！')).toBe(false);
  });

  it('过长的行不算标题', () => {
    expect(isChapterHeading(`第一章 ${'很长的副标题'.repeat(10)}`)).toBe(false);
  });

  it('空行不算标题', () => {
    expect(isChapterHeading('   ')).toBe(false);
  });
});

describe('splitChapters', () => {
  it('按标题切分且区间连续', () => {
    const text = '第一章 开始\n第一章的正文。\n第二章 继续\n第二章的正文。';
    const chapters = splitChapters(text);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章 开始', '第二章 继续']);
    expect(chapters[0].start).toBe(0);
    expect(chapters[0].end).toBe(text.indexOf('第二章 继续'));
    expect(chapters[1].end).toBe(text.length);
    expect(chapters.map((chapter) => chapter.index)).toEqual([0, 1]);
  });

  it('标题前内容足够长时单独成章', () => {
    const preface = `${'这是一段序言。'.repeat(20)}\n`;
    const text = `${preface}第一章 正文\n内容`;
    const chapters = splitChapters(text);
    expect(chapters[0].title).toBe('开始');
    expect(chapters[0].end).toBe(preface.length);
    expect(chapters[1].title).toBe('第一章 正文');
  });

  it('标题前内容太短时并入下一章', () => {
    const text = '短前言\n第一章 正文\n内容';
    const chapters = splitChapters(text);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].start).toBe(0);
    expect(text.slice(chapters[0].start, chapters[0].end)).toBe(text);
  });

  it('章节区间完整覆盖全文', () => {
    const text = '序\n第一章 一\nA\n第二章 二\nB\n第三章 三\nC';
    const chapters = splitChapters(text);
    expect(chapters[0].start).toBe(0);
    expect(chapters[chapters.length - 1].end).toBe(text.length);
    for (let i = 0; i < chapters.length - 1; i += 1) {
      expect(chapters[i].end).toBe(chapters[i + 1].start);
    }
  });

  it('没有标题时按块切分并覆盖全文', () => {
    const text = `${'字'.repeat(6000)}\n${'字'.repeat(6000)}\n${'字'.repeat(6000)}`;
    const chapters = splitChapters(text);
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters[0].start).toBe(0);
    expect(chapters[chapters.length - 1].end).toBe(text.length);
    for (let i = 0; i < chapters.length - 1; i += 1) {
      expect(chapters[i].end).toBe(chapters[i + 1].start);
    }
  });

  it('短文本无标题时只有一章「全文」', () => {
    const chapters = splitChapters('很短的一段正文。');
    expect(chapters).toEqual([{ index: 0, title: '全文', start: 0, end: 8 }]);
  });

  it('空文本返回单个空章节', () => {
    expect(splitChapters('')).toEqual([{ index: 0, title: '全文', start: 0, end: 0 }]);
  });

  it('英文章节也能切分', () => {
    const text = 'Chapter 1\nHello\nChapter 2\nWorld';
    expect(splitChapters(text).map((chapter) => chapter.title)).toEqual([
      'Chapter 1',
      'Chapter 2',
    ]);
  });
});

describe('chapterBody', () => {
  it('去掉与标题重复的首行', () => {
    const text = '第一章 开始\n这是正文';
    const [chapter] = splitChapters(text);
    expect(chapterBody(text, chapter)).toBe('这是正文');
  });

  it('首行不是标题时原样返回', () => {
    const text = '这是一段没有标题的文本';
    const [chapter] = splitChapters(text);
    expect(chapterBody(text, chapter)).toBe(text);
  });

  it('只有标题行时返回空串', () => {
    const text = '第一章 开始';
    const [chapter] = splitChapters(text);
    expect(chapterBody(text, chapter)).toBe('');
  });
});

describe('chapterHasBody', () => {
  it('有正文的章节返回 true', () => {
    const text = '第一章 开始\n这是正文';
    const [chapter] = splitChapters(text);
    expect(chapterHasBody(text, chapter)).toBe(true);
  });

  it('只有标题的章节返回 false', () => {
    const text = '第一章 开始';
    const [chapter] = splitChapters(text);
    expect(chapterHasBody(text, chapter)).toBe(false);
  });

  it('只有空白正文也算空章节', () => {
    const text = '第一章 开始\n   \n\n';
    const [chapter] = splitChapters(text);
    expect(chapterHasBody(text, chapter)).toBe(false);
  });
});

describe('nearestChapterWithBody', () => {
  // 三章：空 / 有正文 / 空
  const text = '第一部\n\n第二章 正文\n这里才是正文\n后记';
  const chapters = splitChapters(text);

  it('向后跳过空章节', () => {
    expect(chapters).toHaveLength(3);
    expect(chapterHasBody(text, chapters[0])).toBe(false);
    expect(nearestChapterWithBody(text, chapters, 0, 1)).toBe(1);
  });

  it('向前跳过空章节', () => {
    expect(chapterHasBody(text, chapters[2])).toBe(false);
    expect(nearestChapterWithBody(text, chapters, 2, -1)).toBe(1);
  });

  it('没有可去的章节时返回 -1', () => {
    expect(nearestChapterWithBody(text, chapters, 1, 1)).toBe(-1);
    expect(nearestChapterWithBody(text, chapters, 0, -1)).toBe(-1);
  });

  it('起点越界也不会死循环', () => {
    expect(nearestChapterWithBody(text, chapters, 99, 1)).toBe(-1);
    expect(nearestChapterWithBody(text, chapters, -5, -1)).toBe(-1);
  });
});
