/** 书籍元数据：目录里展示的静态信息，不含正文。 */
export interface Book {
  id: string;
  title: string;
  author: string;
  /** 来源格式。EPUB 导入时已经抽成纯文本 + 章节；PDF 原样保存，按页渲染。 */
  format: BookFormat;
  /** 导入时识别出的编码，仅作展示与排查用（PDF 固定为 utf-8）。 */
  encoding: TextEncodingName;
  charCount: number;
  /** PDF 总页数：第一次打开时由 pdf.js 统计并回写，供书架展示。 */
  pageCount?: number;
  createdAt: number;
  lastOpenedAt: number | null;
  /** 导入时的原始文件名，便于用户辨认来源。 */
  sourceName: string;
  /** 原始路径；通过拖拽导入时可能为空。 */
  sourcePath: string | null;
}

export type BookFormat = 'txt' | 'epub' | 'pdf';

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';

/** 章节在全文中的字符区间，左闭右开。 */
export interface Chapter {
  index: number;
  title: string;
  start: number;
  end: number;
}

export interface ReadingPosition {
  /**
   * 位置锚点。TXT/EPUB 是全书字符偏移；PDF 是页码（0 基，因为 PDF 没有字符流）。
   * 页码与百分比都由它派生。
   */
  offset?: number;
  /** 旧版本字段，仅用于把老存档迁移成偏移。 */
  chapterIndex?: number;
  /** 旧版本字段，仅用于迁移。 */
  scrollRatio?: number;
}

export interface Progress {
  bookId: string;
  position: ReadingPosition;
  /** 全文百分比，0..1。 */
  percent: number;
  updatedAt: number;
}

/** 书签：位置锚点是 offset（PDF 里存页码，0 基），章节名与摘要是展示快照。 */
export interface Bookmark {
  id: string;
  bookId: string;
  offset: number;
  chapterTitle: string;
  excerpt: string;
  createdAt: number;
}

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type FontFamilyKey = 'serif' | 'sans' | 'deng';
export type FontWeightKey = 'normal' | 'medium' | 'bold';

export interface Prefs {
  fontSize: number;
  lineHeight: number;
  fontFamily: FontFamilyKey;
  /** 字重：低透明度下加粗会更清楚。 */
  fontWeight: FontWeightKey;
  theme: ReaderTheme;
  /** 正文最大宽度（px）；实际渲染时还会受窗口宽度限制。 */
  pageWidth: number;
  /** 段间距（em）。 */
  paragraphSpacing: number;
  /** 正文上下边距（px），同时计入分页高度。 */
  pageMargin: number;
  /** 背景图片的绝对路径；null 表示不启用。 */
  backgroundImage: string | null;
  /** 背景图不透明度（0-1），越低越不影响阅读。 */
  backgroundOpacity: number;
}

/** 书里的一张图：正文里对应的占位符偏移 + media 目录里的文件名 + 原始尺寸。 */
export interface BookImage {
  /** 占位符在全书文本中的字符偏移。 */
  offset: number;
  /** media 目录里的文件名（不含路径）。 */
  file: string;
  width: number;
  height: number;
}

/** 打开一本书时从主进程取回的完整数据。 */
export interface BookContent {
  book: Book;
  text: string;
  chapters: Chapter[];
  images: BookImage[];
}

/** 书架条目：书籍 + 该书的阅读进度。 */
export interface ShelfItem {
  book: Book;
  progress: Progress | null;
}
