import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Book, Bookmark, Prefs, Progress, ShelfItem, TextEncodingName } from '../shared/types';
import { DEFAULT_PREFS, normalizePrefs } from '../core/prefs';
import { clamp } from '../core/progress';
import { BOSS_OPACITY_DEFAULT, clampOpacity } from '../core/window';
import type { Rect } from '../core/window';
import type { ReadingSession } from '../core/stats';

export interface UiState {
  /** 普通模式的窗口位置与大小。 */
  windowBounds: Rect | null;
  /** 老板模式最后停留的位置与大小。 */
  bossBounds: Rect | null;
  /** 老板模式整窗透明度（0.25–1）：越小越透，桌面能透过来，文字也会跟着变淡。 */
  bossOpacity: number;
  /** 老板模式全局热键（Electron accelerator 格式）。 */
  bossHotkey: string;
  /** 进入老板模式前窗口是否最大化 / 全屏，用于精确还原。 */
  bossWasMaximized: boolean;
  bossWasFullScreen: boolean;
}

export interface LibraryData {
  version: number;
  books: Book[];
  progress: Record<string, Progress>;
  bookmarks: Record<string, Bookmark[]>;
  sessions: ReadingSession[];
  prefs: Prefs;
  ui: UiState;
}

export const DATA_VERSION = 1;

/** 老板模式的默认设置：单键 E 开关，背景默认半透。 */
export const DEFAULT_UI: UiState = {
  windowBounds: null,
  bossBounds: null,
  bossOpacity: BOSS_OPACITY_DEFAULT,
  bossHotkey: 'E',
  bossWasMaximized: false,
  bossWasFullScreen: false,
};

/** 允许两种写法：单键（如 E、F9）或「修饰键 + 普通键」（如 Control+Alt+B）。 */
const NAMED_KEYS = /^(F[1-9]|F1[0-2]|Space|Enter|Tab|PageUp|PageDown|Home|End|Insert|Delete|Arrow(Up|Down|Left|Right))$/;

export function normalizeHotkey(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_UI.bossHotkey;
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return DEFAULT_UI.bossHotkey;
  if (parts.length === 1) {
    const single = parts[0];
    const normalized = single.length === 1 ? single.toUpperCase() : single;
    if (normalized.length === 1 && /^[A-Z0-9]$/.test(normalized)) return normalized;
    if (NAMED_KEYS.test(normalized)) return normalized;
    return DEFAULT_UI.bossHotkey;
  }
  const rawKey = parts[parts.length - 1];
  const key = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
  if (key.length !== 1 && !NAMED_KEYS.test(key)) {
    return DEFAULT_UI.bossHotkey;
  }
  const modifiers = parts.slice(0, -1).map((mod) => {
    const lower = mod.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') return 'Control';
    if (lower === 'alt') return 'Alt';
    if (lower === 'shift') return 'Shift';
    if (lower === 'super' || lower === 'meta' || lower === 'cmd') return 'Super';
    return '';
  });
  if (modifiers.some((mod) => !mod)) return DEFAULT_UI.bossHotkey;
  return [...new Set(modifiers), key].join('+');
}

const ENCODINGS: readonly TextEncodingName[] = ['utf-8', 'utf-16le', 'utf-16be', 'gb18030'];

export function emptyLibrary(): LibraryData {
  return {
    version: DATA_VERSION,
    books: [],
    progress: {},
    bookmarks: {},
    sessions: [],
    prefs: { ...DEFAULT_PREFS },
    ui: { ...DEFAULT_UI },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toBook(value: unknown): Book | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!id || !title) return null;
  const encoding = ENCODINGS.includes(value.encoding as TextEncodingName)
    ? (value.encoding as TextEncodingName)
    : 'utf-8';
  return {
    id,
    title,
    author: typeof value.author === 'string' ? value.author : '',
    format: value.format === 'epub' ? 'epub' : value.format === 'pdf' ? 'pdf' : 'txt',
    encoding,
    charCount:
      typeof value.charCount === 'number' && Number.isFinite(value.charCount)
        ? Math.max(0, Math.trunc(value.charCount))
        : 0,
    // 只有 PDF 会用到总页数；其它格式即使存档里有也忽略
    ...(value.format === 'pdf' &&
    typeof value.pageCount === 'number' &&
    Number.isFinite(value.pageCount) &&
    value.pageCount > 0
      ? { pageCount: Math.trunc(value.pageCount) }
      : {}),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    lastOpenedAt: typeof value.lastOpenedAt === 'number' ? value.lastOpenedAt : null,
    sourceName: typeof value.sourceName === 'string' ? value.sourceName : title,
    sourcePath: typeof value.sourcePath === 'string' ? value.sourcePath : null,
  };
}

function toProgress(value: unknown): Progress | null {
  if (!isRecord(value)) return null;
  const bookId = typeof value.bookId === 'string' ? value.bookId : '';
  if (!bookId) return null;
  const position = isRecord(value.position) ? value.position : {};
  const normalized: Progress['position'] = {};
  if (typeof position.offset === 'number' && Number.isFinite(position.offset)) {
    normalized.offset = Math.max(0, Math.round(position.offset));
  }
  if (typeof position.chapterIndex === 'number' && Number.isFinite(position.chapterIndex)) {
    normalized.chapterIndex = Math.max(0, Math.trunc(position.chapterIndex));
  }
  if (typeof position.scrollRatio === 'number' && Number.isFinite(position.scrollRatio)) {
    normalized.scrollRatio = clamp(position.scrollRatio, 0, 1);
  }
  return {
    bookId,
    position: normalized,
    percent: clamp(typeof value.percent === 'number' ? value.percent : 0, 0, 1),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  };
}

/** 把磁盘上可能被手改坏的 library.json 收敛成合法数据。 */
export function normalizeLibrary(raw: unknown): LibraryData {
  const data = emptyLibrary();
  if (!isRecord(raw)) return data;
  if (Array.isArray(raw.books)) {
    const seen = new Set<string>();
    for (const item of raw.books) {
      const book = toBook(item);
      if (book && !seen.has(book.id)) {
        seen.add(book.id);
        data.books.push(book);
      }
    }
  }

  if (isRecord(raw.progress)) {
    for (const [key, item] of Object.entries(raw.progress)) {
      const progress = toProgress(item);
      if (progress && data.books.some((book) => book.id === key)) {
        data.progress[key] = { ...progress, bookId: key };
      }
    }
  }

  data.prefs = normalizePrefs(isRecord(raw.prefs) ? (raw.prefs as Partial<Prefs>) : null);
  data.ui = normalizeUi(raw.ui);
  data.bookmarks = normalizeBookmarks(raw.bookmarks, data.books);
  data.sessions = normalizeSessions(raw.sessions, data.books);
  return data;
}

const MAX_SESSIONS = 5000;

function normalizeSessions(raw: unknown, books: readonly Book[]): ReadingSession[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(books.map((book) => book.id));
  const out: ReadingSession[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const bookId = typeof item.bookId === 'string' ? item.bookId : '';
    const startedAt = typeof item.startedAt === 'number' ? item.startedAt : Number.NaN;
    const seconds = typeof item.seconds === 'number' ? item.seconds : Number.NaN;
    if (!known.has(bookId) || !Number.isFinite(startedAt) || !Number.isFinite(seconds)) continue;
    if (seconds <= 0) continue;
    out.push({ bookId, startedAt, seconds: Math.round(seconds) });
  }
  return out.slice(-MAX_SESSIONS);
}

const MAX_BOOKMARKS_PER_BOOK = 200;

function toBookmark(value: unknown, bookId: string): Bookmark | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) return null;
  return {
    id,
    bookId,
    offset:
      typeof value.offset === 'number' && Number.isFinite(value.offset)
        ? Math.max(0, Math.round(value.offset))
        : 0,
    chapterTitle: typeof value.chapterTitle === 'string' ? value.chapterTitle : '',
    excerpt: typeof value.excerpt === 'string' ? value.excerpt : '',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
  };
}

/** 书签按书分组，丢弃没有对应书籍的条目。 */
export function normalizeBookmarks(raw: unknown, books: readonly Book[]): Record<string, Bookmark[]> {
  const out: Record<string, Bookmark[]> = {};
  if (!isRecord(raw)) return out;
  const known = new Set(books.map((book) => book.id));
  for (const [bookId, items] of Object.entries(raw)) {
    if (!known.has(bookId) || !Array.isArray(items)) continue;
    const seen = new Set<string>();
    const list: Bookmark[] = [];
    for (const item of items) {
      const bookmark = toBookmark(item, bookId);
      if (bookmark && !seen.has(bookmark.id)) {
        seen.add(bookmark.id);
        list.push(bookmark);
      }
    }
    if (list.length > 0) {
      out[bookId] = list.slice(-MAX_BOOKMARKS_PER_BOOK);
    }
  }
  return out;
}

function toRect(value: unknown): Rect | null {
  if (!isRecord(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (width <= 0 || height <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** 窗口状态（位置、老板模式背景浓度）的容错解析。 */
export function normalizeUi(raw: unknown): UiState {
  const source = isRecord(raw) ? raw : {};
  let rawOpacity =
    typeof source.bossOpacity === 'number' ? source.bossOpacity : DEFAULT_UI.bossOpacity;
  // 旧版本有两档（轻度 0.72 / 隐蔽 0.38）；存档里 bossDim=true 说明当时用的是隐蔽档，
  // 按「回档」把它还原成 0.38 的整窗透明度
  if (source.bossDim === true && Math.abs(rawOpacity - 0.72) < 1e-6) rawOpacity = 0.38;
  const opacity = clampOpacity(rawOpacity);
  return {
    windowBounds: toRect(source.windowBounds),
    bossBounds: toRect(source.bossBounds),
    bossOpacity: opacity,
    // 旧版本默认是 Control+Alt+B；按新版默认（单键 E）迁移，其余保持不变
    bossHotkey: normalizeHotkey(source.bossHotkey === 'Control+Alt+B' ? 'E' : source.bossHotkey),
    bossWasMaximized: source.bossWasMaximized === true,
    bossWasFullScreen: source.bossWasFullScreen === true,
  };
}

/**
 * 书库存储：单个 JSON 文件 + 原子写入。
 * 所有写操作串行排队，避免同时保存进度和偏好时互相覆盖。
 */
export class LibraryStore {
  private data: LibraryData = emptyLibrary();
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly baseDir: string) {}

  get dataFile(): string {
    return path.join(this.baseDir, 'library.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.dataFile, 'utf8');
      this.data = normalizeLibrary(JSON.parse(raw) as unknown);
    } catch {
      this.data = emptyLibrary();
    }
    this.loaded = true;
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new Error('LibraryStore 尚未初始化，请先调用 init()');
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const tmp = `${this.dataFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(tmp, this.dataFile);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 按最近打开排序；从未打开过的排在后面按导入时间倒序。 */
  async list(): Promise<Book[]> {
    this.assertLoaded();
    return [...this.data.books].sort((a, b) => {
      const opened = (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0);
      if (opened !== 0) return opened;
      return b.createdAt - a.createdAt;
    });
  }

  async listWithProgress(): Promise<ShelfItem[]> {
    const books = await this.list();
    return books.map((book) => ({ book, progress: this.data.progress[book.id] ?? null }));
  }

  get(id: string): Book | null {
    this.assertLoaded();
    return this.data.books.find((book) => book.id === id) ?? null;
  }

  async add(book: Book): Promise<Book> {
    this.assertLoaded();
    return this.enqueue(async () => {
      const existing = this.data.books.findIndex((item) => item.id === book.id);
      if (existing >= 0) this.data.books[existing] = book;
      else this.data.books.push(book);
      await this.persist();
      return book;
    });
  }

  async remove(id: string): Promise<void> {
    this.assertLoaded();
    await this.enqueue(async () => {
      this.data.books = this.data.books.filter((book) => book.id !== id);
      delete this.data.progress[id];
      delete this.data.bookmarks[id];
      await this.persist();
    });
  }

  async touch(id: string, at: number = Date.now()): Promise<void> {
    this.assertLoaded();
    await this.enqueue(async () => {
      const book = this.data.books.find((item) => item.id === id);
      if (!book) return;
      book.lastOpenedAt = at;
      await this.persist();
    });
  }

  /** PDF 第一次打开后回写总页数（书架要显示「N 页」）。 */
  async setPageCount(id: string, pageCount: number): Promise<Book | null> {
    this.assertLoaded();
    return this.enqueue(async () => {
      const book = this.data.books.find((item) => item.id === id);
      if (!book) return null;
      if (!Number.isFinite(pageCount) || pageCount <= 0) return book;
      book.pageCount = Math.trunc(pageCount);
      await this.persist();
      return book;
    });
  }

  getProgress(bookId: string): Progress | null {
    this.assertLoaded();
    return this.data.progress[bookId] ?? null;
  }

  async setProgress(progress: Progress): Promise<void> {
    this.assertLoaded();
    await this.enqueue(async () => {
      if (!this.data.books.some((book) => book.id === progress.bookId)) return;
      this.data.progress[progress.bookId] = progress;
      await this.persist();
    });
  }

  getPrefs(): Prefs {
    this.assertLoaded();
    return { ...this.data.prefs };
  }

  async setPrefs(patch: Partial<Prefs>): Promise<Prefs> {
    this.assertLoaded();
    return this.enqueue(async () => {
      this.data.prefs = normalizePrefs({ ...this.data.prefs, ...patch });
      await this.persist();
      return { ...this.data.prefs };
    });
  }

  getUi(): UiState {
    this.assertLoaded();
    return { ...this.data.ui };
  }

  async setUi(patch: Partial<UiState>): Promise<UiState> {
    this.assertLoaded();
    return this.enqueue(async () => {
      this.data.ui = normalizeUi({ ...this.data.ui, ...patch });
      await this.persist();
      return { ...this.data.ui };
    });
  }

  getBookmarks(bookId: string): Bookmark[] {
    this.assertLoaded();
    return [...(this.data.bookmarks[bookId] ?? [])].sort((a, b) => a.offset - b.offset);
  }

  /** 正文被清理（删掉乱码行）后，把书签偏移一起挪到新位置。 */
  async remapBookmarks(bookId: string, mapper: (offset: number) => number): Promise<void> {
    this.assertLoaded();
    const list = this.data.bookmarks[bookId];
    if (!list || list.length === 0) return;
    await this.enqueue(async () => {
      this.data.bookmarks[bookId] = list
        .map((item) => ({ ...item, offset: mapper(item.offset) }))
        .sort((a, b) => a.offset - b.offset);
      await this.persist();
    });
  }

  async addBookmark(bookmark: Bookmark): Promise<Bookmark> {
    this.assertLoaded();
    return this.enqueue(async () => {
      if (!this.data.books.some((book) => book.id === bookmark.bookId)) return bookmark;
      const list = this.data.bookmarks[bookmark.bookId] ?? [];
      const next = list.filter((item) => item.id !== bookmark.id);
      next.push(bookmark);
      this.data.bookmarks[bookmark.bookId] = next
        .sort((a, b) => a.offset - b.offset)
        .slice(-MAX_BOOKMARKS_PER_BOOK);
      await this.persist();
      return bookmark;
    });
  }

  async removeBookmark(bookId: string, id: string): Promise<void> {
    this.assertLoaded();
    await this.enqueue(async () => {
      const list = this.data.bookmarks[bookId];
      if (!list) return;
      this.data.bookmarks[bookId] = list.filter((item) => item.id !== id);
      if (this.data.bookmarks[bookId].length === 0) delete this.data.bookmarks[bookId];
      await this.persist();
    });
  }

  getSessions(): ReadingSession[] {
    this.assertLoaded();
    return this.data.sessions.map((session) => ({ ...session }));
  }

  async addSession(session: ReadingSession): Promise<void> {
    this.assertLoaded();
    await this.enqueue(async () => {
      if (!this.data.books.some((book) => book.id === session.bookId)) return;
      if (!Number.isFinite(session.seconds) || session.seconds <= 0) return;
      this.data.sessions.push({
        bookId: session.bookId,
        startedAt: session.startedAt,
        seconds: Math.round(session.seconds),
      });
      if (this.data.sessions.length > MAX_SESSIONS) {
        this.data.sessions = this.data.sessions.slice(-MAX_SESSIONS);
      }
      await this.persist();
    });
  }

  async clearSessions(): Promise<void> {
    this.assertLoaded();
    await this.enqueue(async () => {
      this.data.sessions = [];
      await this.persist();
    });
  }
}
