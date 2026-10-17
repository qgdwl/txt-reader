import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { decodeText } from '../core/encoding';
import { splitChapters } from '../core/chapters';
import { cleanNoiseLines, remapOffset } from '../core/textclean';
import { alignOffsets } from '../core/images';
import { parseFileName, resolveBookMeta } from '../core/metadata';
import { looksLikePdf } from '../core/pdf';
import type { Book, BookContent, BookFormat, BookImage, Chapter } from '../shared/types';
import { parseEpub } from './epub';
import type { EpubChapter } from './epub';
import type { LibraryStore } from './store';

/** 书籍正文存放目录：把原文件复制进来，原文件被移动或删除也不影响阅读。 */
export function contentDir(baseDir: string): string {
  return path.join(baseDir, 'books');
}

export function contentFile(baseDir: string, id: string): string {
  return path.join(contentDir(baseDir), `${id}.txt`);
}

/** PDF 原样保存，打开时交给 pdf.js 按页渲染（不做文字抽取）。 */
export function pdfFile(baseDir: string, id: string): string {
  return path.join(contentDir(baseDir), `${id}.pdf`);
}

/** EPUB 的章节划分来自原书目录，导入时算好存盘，避免每次打开重算。 */
export function chaptersFile(baseDir: string, id: string): string {
  return path.join(contentDir(baseDir), `${id}.chapters.json`);
}

export function detectFormat(fileName: string, bytes: Uint8Array): BookFormat {
  if (/\.pdf$/i.test(fileName)) return 'pdf';
  if (/\.epub$/i.test(fileName)) return 'epub';
  // 没有扩展名但确实是 ZIP（EPUB 就是 ZIP），交回调用方按 txt 处理会读出乱码，
  // 所以只认扩展名，避免把普通 zip 误判成书。
  void bytes;
  return 'txt';
}

/** 图片目录：`books/<id>.media/`，与正文文件放在一起。 */
export function mediaDir(baseDir: string, id: string): string {
  return path.join(contentDir(baseDir), `${id}.media`);
}

/** 图片索引：偏移 + 文件名 + 原始尺寸。 */
export function mediaFile(baseDir: string, id: string): string {
  return path.join(contentDir(baseDir), `${id}.media.json`);
}

/** 把 EPUB 的章节拼成一份连续文本，并记录每章的字符区间。 */export function combineEpubChapters(chapters: readonly EpubChapter[]): {
  text: string;
  chapters: Chapter[];
  /** 图片占位符在全书文本里的绝对偏移 + 尺寸（文件名要到写盘时才定）。 */
  images: Array<{
    offset: number;
    fileName: string;
    data: Uint8Array;
    width: number;
    height: number;
  }>;
} {
  let text = '';
  const offsets: Chapter[] = [];
  const images: Array<{
    offset: number;
    fileName: string;
    data: Uint8Array;
    width: number;
    height: number;
  }> = [];
  chapters.forEach((chapter, index) => {
    const start = text.length;
    const bodyStart = start + chapter.title.length + 1;
    text += `${chapter.title}\n${chapter.text}`;
    const end = text.length;
    offsets.push({ index, title: chapter.title, start, end });
    for (const image of chapter.images ?? []) {
      images.push({
        offset: bodyStart + image.offset,
        fileName: image.fileName,
        data: image.data,
        width: image.width,
        height: image.height,
      });
    }
    text += '\n\n';
  });
  return { text, chapters: offsets, images };
}

async function writeChapters(baseDir: string, id: string, chapters: Chapter[]): Promise<void> {
  await fs.mkdir(contentDir(baseDir), { recursive: true });
  await fs.writeFile(chaptersFile(baseDir, id), JSON.stringify(chapters), 'utf8');
}

async function readStoredChapters(baseDir: string, id: string): Promise<Chapter[] | null> {
  try {
    const raw = await fs.readFile(chaptersFile(baseDir, id), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const chapters = parsed.filter(
      (item): item is Chapter =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Chapter).title === 'string' &&
        Number.isFinite((item as Chapter).start) &&
        Number.isFinite((item as Chapter).end),
    );
    return chapters.length > 0 ? chapters : null;
  } catch {
    return null;
  }
}

/**
 * 导入 PDF：原样复制一份到书库，不做文字抽取。
 *
 * 技术类 PDF 大量依赖图、公式、表格，抽成纯文本会丢一半信息，
 * 所以阅读层用 pdf.js 按页渲染成图片（一页一屏），看起来和原书一致。
 */
async function importPdfBook(
  store: LibraryStore,
  baseDir: string,
  fileName: string,
  bytes: Uint8Array,
  sourcePath: string | null,
): Promise<Book> {
  if (!looksLikePdf(bytes)) {
    throw new Error(`「${path.basename(fileName)}」不是有效的 PDF 文件`);
  }
  const id = randomUUID();
  const meta = parseFileName(fileName);
  await fs.mkdir(contentDir(baseDir), { recursive: true });
  await fs.writeFile(pdfFile(baseDir, id), bytes);

  const book: Book = {
    id,
    title: meta.title,
    author: meta.author,
    format: 'pdf',
    encoding: 'utf-8',
    // PDF 没有字符流，字数固定为 0；进度与页数走页码
    charCount: 0,
    createdAt: Date.now(),
    lastOpenedAt: null,
    sourceName: path.basename(fileName),
    sourcePath,
  };
  await store.add(book);
  return book;
}

export async function importBookBytes(
  store: LibraryStore,
  baseDir: string,
  fileName: string,
  bytes: Uint8Array,
  sourcePath: string | null = null,
): Promise<Book> {
  const format = detectFormat(fileName, bytes);
  if (format === 'pdf') {
    return importPdfBook(store, baseDir, fileName, bytes, sourcePath);
  }
  const id = randomUUID();

  let text: string;
  let chapters: Chapter[] | null = null;
  let title: string;
  let author: string;
  let encoding: Book['encoding'];
  let images: Array<{
    offset: number;
    fileName: string;
    data: Uint8Array;
    width: number;
    height: number;
  }> = [];

  if (format === 'epub') {
    const parsed = parseEpub(bytes);
    const combined = combineEpubChapters(parsed.chapters);
    text = combined.text;
    chapters = combined.chapters;
    images = combined.images;
    if (parsed.skippedImages > 0) {
      console.warn(`[library] ${fileName}: 跳过 ${parsed.skippedImages} 张过大的图片`);
    }
    const fromName = parseFileName(fileName);
    title = parsed.title || fromName.title;
    author = parsed.author || fromName.author;
    encoding = 'utf-8';
  } else {
    const decoded = decodeText(bytes);
    text = decoded.text;
    encoding = decoded.encoding;
    const meta = resolveBookMeta(fileName, text);
    title = meta.title;
    author = meta.author;
  }

  await fs.mkdir(contentDir(baseDir), { recursive: true });
  await fs.writeFile(contentFile(baseDir, id), text, 'utf8');
  if (chapters) await writeChapters(baseDir, id, chapters);

  // 图片偏移必须和正文里的占位符一一对应：
  // 万一提取/拼接过程中正文长度变了，这里兜底对齐一次（正常情况不会有改动）
  if (images.length > 0) {
    const aligned = alignOffsets(images, text);
    if (aligned.changed) {
      console.warn(`[library] ${fileName}: 修正 ${aligned.moved} 张图片的位置`);
    }
    if (aligned.aligned) images = aligned.items;
  }

  // 图片按内容哈希命名，同一张图在多章出现只存一份
  const storedImages: BookImage[] = [];
  if (images.length > 0) {
    const dir = mediaDir(baseDir, id);
    await fs.mkdir(dir, { recursive: true });
    const hashes = new Map<string, string>();
    for (const image of images) {
      const hash = createHash('sha1').update(image.data).digest('hex').slice(0, 16);
      const extension = (path.extname(image.fileName) || '.jpg').toLowerCase();
      const file = `${hash}${extension}`;
      if (!hashes.has(file)) {
        hashes.set(file, file);
        await fs.writeFile(path.join(dir, file), image.data);
      }
      storedImages.push({
        offset: image.offset,
        file,
        width: image.width,
        height: image.height,
      });
    }
    await fs.writeFile(mediaFile(baseDir, id), JSON.stringify(storedImages), 'utf8');
  }

  const book: Book = {
    id,
    title,
    author,
    format,
    encoding,
    charCount: text.length,
    createdAt: Date.now(),
    lastOpenedAt: null,
    sourceName: path.basename(fileName),
    sourcePath,
  };
  await store.add(book);
  return book;
}

export async function importBookFile(
  store: LibraryStore,
  baseDir: string,
  filePath: string,
): Promise<Book> {
  const bytes = new Uint8Array(await fs.readFile(filePath));
  return importBookBytes(store, baseDir, path.basename(filePath), bytes, filePath);
}

/** 打开一本书：读正文、解码、现算章节（EPUB 直接用导入时算好的）。 */
export async function loadBookContent(
  store: LibraryStore,
  baseDir: string,
  id: string,
): Promise<BookContent> {
  const book = store.get(id);
  if (!book) throw new Error(`找不到书籍：${id}`);

  // PDF 没有可解码的正文：阅读层拿到占位章节后，走独立的按页渲染视图
  if (book.format === 'pdf') {
    const openedAt = Date.now();
    await store.touch(id, openedAt);
    return {
      book: { ...book, lastOpenedAt: openedAt },
      text: '',
      chapters: [{ index: 0, title: 'PDF', start: 0, end: 0 }],
      images: [],
    };
  }

  const raw = await fs.readFile(contentFile(baseDir, id));
  const stored = await readStoredChapters(baseDir, id);
  // EPUB 存的是已解码文本；TXT 存的是原始字节，需要按编码解一次
  let text = stored ? raw.toString('utf8') : decodeText(new Uint8Array(raw)).text;
  let chapters = stored ?? splitChapters(text);
  let images = await readStoredImages(baseDir, id);
  let mediaDirty = false;

  // 老版本导入的书里可能混着 base64 乱码行：打开时自动清掉，
  // 并把章节、进度、书签、插图的偏移一起挪到新位置（只做一次，结果写回磁盘）
  const cleaned = cleanNoiseLines(text);
  if (cleaned.removed > 0) {
    const remapped = chapters.map((chapter) => ({
      ...chapter,
      start: remapOffset(chapter.start, cleaned.ranges),
      end: remapOffset(chapter.end, cleaned.ranges),
    }));
    console.warn(
      `[library] ${book.title.slice(0, 16)}: 清理 ${cleaned.ranges.length} 行乱码（${cleaned.removed} 字）`,
    );
    await fs.writeFile(contentFile(baseDir, id), cleaned.text, 'utf8');
    await writeChapters(baseDir, id, remapped);
    if (images.length > 0) {
      images = images.map((image) => ({
        ...image,
        offset: remapOffset(image.offset, cleaned.ranges),
      }));
      mediaDirty = true;
    }
    const progress = store.getProgress(id);
    if (progress) {
      const oldOffset = progress.position.offset ?? 0;
      const offset = remapOffset(oldOffset, cleaned.ranges);
      await store.setProgress({
        ...progress,
        position: { offset },
        percent: cleaned.text.length > 0 ? offset / cleaned.text.length : 0,
        updatedAt: Date.now(),
      });
    }
    await store.remapBookmarks(id, (offset) => remapOffset(offset, cleaned.ranges));
    text = cleaned.text;
    chapters = remapped;
  }

  // 旧书的兜底修复：正文曾经被清理变短、但图片索引还停在旧偏移上，
  // 表现是所有插图都显示成「[图片]」。按占位符重新对齐并写回索引。
  const aligned = alignOffsets(images, text);
  if (aligned.changed) {
    console.warn(
      `[library] ${book.title.slice(0, 16)}: 修正 ${aligned.moved} 张图片的位置（旧索引与正文错位）`,
    );
    images = aligned.items;
    mediaDirty = true;
  } else if (!aligned.aligned && images.length > 0) {
    console.warn(
      `[library] ${book.title.slice(0, 16)}: 图片索引与正文占位符对不上，且无法自动修复`,
    );
    images = aligned.items;
  }
  if (mediaDirty) await writeStoredImages(baseDir, id, images);

  const openedAt = Date.now();
  await store.touch(id, openedAt);

  return {
    book: { ...book, lastOpenedAt: openedAt },
    text,
    chapters,
    images,
  };
}

/** 读图片索引；老版本的书没有这个文件，当成没有图片。 */
async function readStoredImages(baseDir: string, id: string): Promise<BookImage[]> {
  try {
    const raw = await fs.readFile(mediaFile(baseDir, id), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is BookImage =>
        typeof item === 'object' &&
        item !== null &&
        Number.isFinite((item as BookImage).offset) &&
        typeof (item as BookImage).file === 'string' &&
        (item as BookImage).file.length > 0 &&
        Number.isFinite((item as BookImage).width) &&
        Number.isFinite((item as BookImage).height),
    );
  } catch {
    return [];
  }
}

/** 读 PDF 原始字节，通过 IPC 交给渲染层的 pdf.js。 */
export async function readPdfBytes(baseDir: string, id: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await fs.readFile(pdfFile(baseDir, id)));
  } catch {
    throw new Error('PDF 文件已丢失，请重新导入这本书');
  }
}

/** 写回图片索引（自动修复偏移后调用）。 */
async function writeStoredImages(
  baseDir: string,
  id: string,
  images: readonly BookImage[],
): Promise<void> {
  await fs.mkdir(contentDir(baseDir), { recursive: true });
  await fs.writeFile(mediaFile(baseDir, id), JSON.stringify(images), 'utf8');
}

export async function removeBookContent(baseDir: string, id: string): Promise<void> {
  await fs.rm(contentFile(baseDir, id), { force: true });
  await fs.rm(pdfFile(baseDir, id), { force: true });
  await fs.rm(chaptersFile(baseDir, id), { force: true });
  await fs.rm(mediaFile(baseDir, id), { force: true });
  await fs.rm(mediaDir(baseDir, id), { recursive: true, force: true });
}
