import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { LibraryStore, emptyLibrary, normalizeHotkey, normalizeLibrary, normalizeUi } from '../src/main/store';
import type { Book, Bookmark, Progress } from '../src/shared/types';
import { makeTempDir } from './helpers/tmp';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: '测试书',
    author: '作者',
    format: 'txt',
    encoding: 'utf-8',
    charCount: 100,
    createdAt: 1000,
    lastOpenedAt: null,
    sourceName: '测试书.txt',
    sourcePath: null,
    ...overrides,
  };
}

function makeProgress(bookId: string, percent: number): Progress {
  return {
    bookId,
    position: { chapterIndex: 1, scrollRatio: percent },
    percent,
    updatedAt: 1234,
  };
}

async function openStore(): Promise<{ dir: string; store: LibraryStore }> {
  const dir = await makeTempDir('store');
  const store = new LibraryStore(dir);
  await store.init();
  return { dir, store };
}

describe('LibraryStore 基本行为', () => {
  it('空目录初始化得到空书库与默认偏好', async () => {
    const { store } = await openStore();
    expect(await store.list()).toEqual([]);
    expect(store.getPrefs().theme).toBe('light');
  });

  it('未初始化时调用会抛错', () => {
    const store = new LibraryStore('unused');
    expect(() => store.getPrefs()).toThrow('尚未初始化');
  });

  it('按最近打开排序，未打开过的按导入时间倒序', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'a', createdAt: 1 }));
    await store.add(makeBook({ id: 'b', createdAt: 2 }));
    expect((await store.list()).map((book) => book.id)).toEqual(['b', 'a']);

    await store.touch('a', 500);
    expect((await store.list()).map((book) => book.id)).toEqual(['a', 'b']);
  });

  it('重复新增同一个 id 会覆盖', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'a', title: '旧标题' }));
    await store.add(makeBook({ id: 'a', title: '新标题' }));
    expect(await store.list()).toHaveLength(1);
    expect(store.get('a')?.title).toBe('新标题');
  });

  it('数据能持久化并被新实例读回', async () => {
    const { dir, store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.setProgress(makeProgress('a', 0.42));

    const reopened = new LibraryStore(dir);
    await reopened.init();
    expect(reopened.get('a')?.title).toBe('测试书');
    expect(reopened.getProgress('a')?.percent).toBe(0.42);
  });

  it('不存在的书不记录进度', async () => {
    const { store } = await openStore();
    await store.setProgress(makeProgress('ghost', 0.5));
    expect(store.getProgress('ghost')).toBeNull();
  });

  it('PDF 总页数回写后可持久化读回', async () => {
    const { dir, store } = await openStore();
    await store.add(makeBook({ id: 'pdf-1', format: 'pdf', charCount: 0 }));
    const updated = await store.setPageCount('pdf-1', 128.9);
    expect(updated?.pageCount).toBe(128);

    const reopened = new LibraryStore(dir);
    await reopened.init();
    expect(reopened.get('pdf-1')?.pageCount).toBe(128);
  });

  it('非法页数不覆盖已有值，不存在的书返回 null', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'pdf-1', format: 'pdf', pageCount: 12 }));
    await store.setPageCount('pdf-1', 0);
    await store.setPageCount('pdf-1', Number.NaN);
    expect(store.get('pdf-1')?.pageCount).toBe(12);
    expect(await store.setPageCount('ghost', 10)).toBeNull();
  });

  it('删除书籍同时清掉进度', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.setProgress(makeProgress('a', 0.3));
    await store.remove('a');
    expect(await store.list()).toEqual([]);
    expect(store.getProgress('a')).toBeNull();
  });

  it('偏好会被规范化后保存', async () => {
    const { store } = await openStore();
    const saved = await store.setPrefs({ fontSize: 999, theme: 'dark' });
    expect(saved.fontSize).toBe(40);
    expect(saved.theme).toBe('dark');
    expect(store.getPrefs().fontSize).toBe(40);
  });

  it('损坏的 library.json 回退为空库', async () => {
    const { dir } = await openStore();
    const store = new LibraryStore(dir);
    await store.init();
    await store.add(makeBook({ id: 'a' }));

    const { writeFile } = await import('node:fs/promises');
    const path = await import('node:path');
    await writeFile(path.join(dir, 'library.json'), '{ 这不是 JSON', 'utf8');

    const broken = new LibraryStore(dir);
    await broken.init();
    expect(await broken.list()).toEqual([]);
  });

  it('并发写入后文件仍是合法 JSON', async () => {
    const { dir, store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await Promise.all(
      Array.from({ length: 10 }, (_, index) => store.setProgress(makeProgress('a', index / 10))),
    );
    const raw = await readFile(new LibraryStore(dir).dataFile, 'utf8');
    const parsed = JSON.parse(raw) as { progress: Record<string, Progress> };
    expect(parsed.progress.a.bookId).toBe('a');
    expect(parsed.progress.a.percent).toBe(0.9);
  });
});

describe('normalizeLibrary', () => {
  it('非对象输入得到空库', () => {
    expect(normalizeLibrary(null)).toEqual(emptyLibrary());
    expect(normalizeLibrary('x')).toEqual(emptyLibrary());
  });

  it('丢弃缺少 id 或标题的记录', () => {
    const data = normalizeLibrary({
      books: [{ id: 'a', title: '好书' }, { id: '', title: '无 id' }, { id: 'b' }],
    });
    expect(data.books.map((book) => book.id)).toEqual(['a']);
  });

  it('去掉重复 id', () => {
    const data = normalizeLibrary({
      books: [
        { id: 'a', title: '第一本' },
        { id: 'a', title: '重复的' },
      ],
    });
    expect(data.books).toHaveLength(1);
    expect(data.books[0].title).toBe('第一本');
  });

  it('丢弃没有对应书籍的进度', () => {
    const data = normalizeLibrary({
      books: [{ id: 'a', title: '书' }],
      progress: {
        a: { bookId: 'a', position: { chapterIndex: 2, scrollRatio: 0.5 }, percent: 0.25 },
        b: { bookId: 'b', position: { chapterIndex: 1, scrollRatio: 0.1 }, percent: 0.1 },
      },
    });
    expect(Object.keys(data.progress)).toEqual(['a']);
  });

  it('非法编码字段回退为 utf-8', () => {
    const data = normalizeLibrary({ books: [{ id: 'a', title: '书', encoding: 'latin-1' }] });
    expect(data.books[0].encoding).toBe('utf-8');
  });

  it('保留 pdf 格式与总页数，非 PDF 记录忽略 pageCount', () => {
    const data = normalizeLibrary({
      books: [
        { id: 'a', title: 'PDF 书', format: 'pdf', pageCount: 88 },
        { id: 'b', title: 'TXT 书', format: 'txt', pageCount: 99 },
        { id: 'c', title: '老书', format: 'unknown', pageCount: 7 },
      ],
    });
    expect(data.books.map((book) => book.format)).toEqual(['pdf', 'txt', 'txt']);
    expect(data.books[0].pageCount).toBe(88);
    expect(data.books[1].pageCount).toBeUndefined();
    expect(data.books[2].pageCount).toBeUndefined();
  });

  it('非法 pageCount 被丢弃', () => {
    const data = normalizeLibrary({
      books: [
        { id: 'a', title: 'A', format: 'pdf', pageCount: 0 },
        { id: 'b', title: 'B', format: 'pdf', pageCount: -3 },
        { id: 'c', title: 'C', format: 'pdf', pageCount: '很多' },
      ],
    });
    expect(data.books.every((book) => book.pageCount === undefined)).toBe(true);
  });

  it('缺少 ui 字段时给出默认窗口状态', () => {
    const data = normalizeLibrary({ books: [] });
    expect(data.ui.bossOpacity).toBeCloseTo(0.72, 2);
    expect(data.ui.windowBounds).toBeNull();
  });
});

describe('normalizeUi', () => {
  it('非对象输入得到默认值', () => {
    expect(normalizeUi(null)).toEqual(emptyLibrary().ui);
  });

  it('透明度越界收敛', () => {
    expect(normalizeUi({ bossOpacity: 5 }).bossOpacity).toBe(1);
    expect(normalizeUi({ bossOpacity: 0 }).bossOpacity).toBe(0.25);
    expect(normalizeUi({ bossOpacity: -1 }).bossOpacity).toBe(0.25);
  });

  it('旧版「隐蔽档」（0.72 + bossDim）回档为 0.38 的整窗透明度', () => {
    expect(normalizeUi({ bossOpacity: 0.72, bossDim: true }).bossOpacity).toBeCloseTo(0.38, 2);
    expect(normalizeUi({ bossOpacity: 0.72 }).bossOpacity).toBeCloseTo(0.72, 2);
  });

  it('尺寸非法的位置被丢弃', () => {
    expect(normalizeUi({ windowBounds: { x: 1, y: 2, width: 0, height: 100 } }).windowBounds).toBeNull();
    expect(normalizeUi({ bossBounds: 'nope' }).bossBounds).toBeNull();
  });

  it('合法位置被保留并取整', () => {
    const ui = normalizeUi({ bossBounds: { x: 10.6, y: 20.2, width: 440.7, height: 320.4 } });
    expect(ui.bossBounds).toEqual({ x: 11, y: 20, width: 441, height: 320 });
  });
});

describe('UI 状态持久化', () => {
  it('默认值可用，写入后能被新实例读回', async () => {
    const { dir, store } = await openStore();
    expect(store.getUi().bossBounds).toBeNull();

    await store.setUi({
      bossBounds: { x: 24, y: 500, width: 440, height: 320 },
      bossOpacity: 0.5,
    });

    const reopened = new LibraryStore(dir);
    await reopened.init();
    const ui = reopened.getUi();
    expect(ui.bossBounds).toEqual({ x: 24, y: 500, width: 440, height: 320 });
    expect(ui.bossOpacity).toBe(0.5);
  });

  it('局部更新不会冲掉其它字段', async () => {
    const { store } = await openStore();
    await store.setUi({ bossOpacity: 0.4 });
    await store.setUi({ bossHotkey: 'F9' });
    expect(store.getUi().bossOpacity).toBe(0.4);
    expect(store.getUi().bossHotkey).toBe('F9');
  });
});

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'mark-1',
    bookId: 'a',
    offset: 10,
    chapterTitle: '第一章',
    excerpt: '…雨下了整夜…',
    createdAt: 1000,
    ...overrides,
  };
}

describe('书签', () => {
  it('新增后按偏移排序返回', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.addBookmark(makeBookmark({ id: 'm2', offset: 80 }));
    await store.addBookmark(makeBookmark({ id: 'm1', offset: 20 }));

    expect(store.getBookmarks('a').map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('持久化后能被新实例读回', async () => {
    const { dir, store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.addBookmark(makeBookmark());

    const reopened = new LibraryStore(dir);
    await reopened.init();
    expect(reopened.getBookmarks('a')).toHaveLength(1);
    expect(reopened.getBookmarks('a')[0].excerpt).toBe('…雨下了整夜…');
  });

  it('不存在的书不记录书签', async () => {
    const { store } = await openStore();
    await store.addBookmark(makeBookmark({ bookId: 'ghost' }));
    expect(store.getBookmarks('ghost')).toEqual([]);
  });

  it('删除单条书签', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.addBookmark(makeBookmark({ id: 'm1' }));
    await store.addBookmark(makeBookmark({ id: 'm2', offset: 50 }));
    await store.removeBookmark('a', 'm1');
    expect(store.getBookmarks('a').map((m) => m.id)).toEqual(['m2']);
  });

  it('删除书籍时书签一并清掉', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.addBookmark(makeBookmark());
    await store.remove('a');
    expect(store.getBookmarks('a')).toEqual([]);
  });

  it('同一个 id 重复添加只保留一条', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.addBookmark(makeBookmark({ excerpt: '旧' }));
    await store.addBookmark(makeBookmark({ excerpt: '新' }));
    const list = store.getBookmarks('a');
    expect(list).toHaveLength(1);
    expect(list[0].excerpt).toBe('新');
  });
});

describe('阅读记录', () => {
  it('记录后可以读回并持久化', async () => {
    const { dir, store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.addSession({ bookId: 'a', startedAt: 1000, seconds: 60 });

    expect(store.getSessions()).toEqual([{ bookId: 'a', startedAt: 1000, seconds: 60 }]);

    const reopened = new LibraryStore(dir);
    await reopened.init();
    expect(reopened.getSessions()).toHaveLength(1);
  });

  it('忽略不存在的书与非法时长', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.addSession({ bookId: 'ghost', startedAt: 1, seconds: 30 });
    await store.addSession({ bookId: 'a', startedAt: 1, seconds: 0 });
    await store.addSession({ bookId: 'a', startedAt: 1, seconds: Number.NaN });
    expect(store.getSessions()).toEqual([]);
  });

  it('清空统计', async () => {
    const { store } = await openStore();
    await store.add(makeBook({ id: 'a' }));
    await store.addSession({ bookId: 'a', startedAt: 1, seconds: 30 });
    await store.clearSessions();
    expect(store.getSessions()).toEqual([]);
  });
});

describe('老板模式热键规范化', () => {
  it('补全修饰键写法', () => {
    expect(normalizeHotkey('ctrl+alt+b')).toBe('Control+Alt+B');
    expect(normalizeHotkey('Control+Shift+M')).toBe('Control+Shift+M');
  });

  it('单键也接受，小写自动转大写', () => {
    expect(normalizeHotkey('e')).toBe('E');
    expect(normalizeHotkey('E')).toBe('E');
    expect(normalizeHotkey('F9')).toBe('F9');
  });

  it('非法输入回退默认单键', () => {
    expect(normalizeHotkey('')).toBe('E');
    expect(normalizeHotkey(42)).toBe('E');
    expect(normalizeHotkey('Foo')).toBe('E');
  });

  it('未知键名回退默认', () => {
    expect(normalizeHotkey('Control+Foo')).toBe('E');
  });

  it('支持功能键与方向键', () => {
    expect(normalizeHotkey('Control+F8')).toBe('Control+F8');
    expect(normalizeHotkey('Alt+ArrowLeft')).toBe('Alt+ArrowLeft');
  });

  it('重复修饰键去重', () => {
    expect(normalizeHotkey('Control+Ctrl+B')).toBe('Control+B');
  });
});

describe('热键持久化', () => {
  it('写入后能被新实例读回', async () => {
    const { dir, store } = await openStore();
    await store.setUi({ bossHotkey: 'Control+Shift+M' });
    const reopened = new LibraryStore(dir);
    await reopened.init();
    expect(reopened.getUi().bossHotkey).toBe('Control+Shift+M');
  });

  it('非法热键在持久化时被规范化', async () => {
    const { store } = await openStore();
    await store.setUi({ bossHotkey: 'nonsense' });
    expect(store.getUi().bossHotkey).toBe('E');
  });
});
