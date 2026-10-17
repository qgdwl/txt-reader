import type { Book, BookContent, Bookmark, Prefs, Progress, ShelfItem } from './types';
import type { StatsSummary } from '../core/stats';

/** 老板模式（小窗隐身）状态。 */
export interface BossState {
  boss: boolean;
  /** 背景浓度：越大越接近纸色，越小越透（文字始终实心）。 */
  opacity: number;
  /** 老板模式全局热键（Electron accelerator 格式）。 */
  hotkey: string;
}

/** 渲染进程可见的 API（由 preload 通过 contextBridge 注入到 window.reader）。 */
export interface ImageApi {
  /** 弹窗选一张背景图，返回绝对路径；取消返回 null。 */
  pick(): Promise<string | null>;
  /** 读成 data URL（避开 file:// 在 http 页面下被拦截的问题）。 */
  data(path: string): Promise<string | null>;
  /** 读书内图片（bookId + media 文件名），返回 data URL；失败返回 null。 */
  book(bookId: string, file: string): Promise<string | null>;
}

/** PDF 相关：把原始字节交给渲染层的 pdf.js，并回写页数。 */
export interface PdfApi {
  /** 读取 PDF 原始字节（打开时调用一次）。 */
  read(bookId: string): Promise<ArrayBuffer>;
  /** 第一次打开后回写总页数，供书架展示。 */
  savePageCount(bookId: string, pageCount: number): Promise<Book | null>;
}

export interface ReaderApi {
  library: {
    list(): Promise<ShelfItem[]>;
    /** 打开系统文件对话框导入，返回新导入的书籍（取消时为空数组）。 */
    importViaDialog(): Promise<Book[]>;
    /** 拖拽导入：fileName 仅用于猜书名与记录来源。 */
    importBytes(fileName: string, data: ArrayBuffer, sourcePath?: string | null): Promise<Book>;
    remove(id: string): Promise<void>;
    open(id: string): Promise<BookContent>;
  };
  progress: {
    get(bookId: string): Promise<Progress | null>;
    set(progress: Progress): Promise<void>;
  };
  prefs: {
    get(): Promise<Prefs>;
    set(patch: Partial<Prefs>): Promise<Prefs>;
  };
  bookmarks: {
    list(bookId: string): Promise<Bookmark[]>;
    add(input: {
      bookId: string;
      offset: number;
      chapterTitle: string;
      excerpt: string;
    }): Promise<Bookmark>;
    remove(bookId: string, id: string): Promise<void>;
  };
  stats: {
    /** 汇总最近 windowDays 天的阅读时长。 */
    summary(windowDays?: number): Promise<StatsSummary>;
    addSession(session: { bookId: string; startedAt: number; seconds: number }): Promise<void>;
    clear(): Promise<void>;
  };
  image: ImageApi;
  pdf: PdfApi;
  window: {
    getState(): Promise<BossState>;
    /** 进入/退出老板模式，返回切换后的状态。 */
    toggleBoss(on?: boolean): Promise<boolean>;
    /** 调整老板模式背景浓度（0–1，0 表示完全透明），返回落库后的值。 */
    setBossTint(value: number): Promise<number>;
    /** 修改老板模式热键，注册失败返回 false（旧热键保持可用）。 */
    setHotkey(accelerator: string): Promise<boolean>;
    /** 订阅老板模式变化（含全局热键触发），返回取消订阅函数。 */
    onBossChanged(callback: (state: BossState) => void): () => void;
  };
}
