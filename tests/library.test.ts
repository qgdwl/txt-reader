import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LibraryStore } from '../src/main/store';
import {
  chaptersFile,
  combineEpubChapters,
  contentFile,
  detectFormat,
  importBookBytes,
  importBookFile,
  loadBookContent,
  mediaFile,
  pdfFile,
  readPdfBytes,
  removeBookContent,
} from '../src/main/library';
import { IMAGE_PLACEHOLDER } from '../src/core/images';
import type { Book } from '../src/shared/types';
import { makeZip } from './helpers/zip';
import { tinyPng } from './helpers/png';
import { makeTempDir } from './helpers/tmp';

// GBK 编码的「中文」
const GBK_ZHONGWEN = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);

/** 结构最小的 PDF：导入层只校验文件头，真正的解析在渲染层。 */
function samplePdf(): Uint8Array {
  return new TextEncoder().encode(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  );
}

async function setup(): Promise<{ dir: string; store: LibraryStore }> {
  const dir = await makeTempDir('library');
  const store = new LibraryStore(dir);
  await store.init();
  return { dir, store };
}

function sampleEpub(): Uint8Array {
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>山海旧事</dc:title><dc:creator>沈砚</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;
  return makeZip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': container,
    'OEBPS/content.opf': opf,
    'OEBPS/ch1.xhtml': '<html><body><h1>第一章 归途</h1><p>雨下了整夜。</p><p>他推开门。</p></body></html>',
    'OEBPS/ch2.xhtml': '<html><body><h1>第二章 旧信</h1><p>抽屉里压着一叠信。</p></body></html>',
  });
}

function placeholderPositions(text: string): number[] {
  const out: number[] = [];
  let index = text.indexOf(IMAGE_PLACEHOLDER);
  while (index !== -1) {
    out.push(index);
    index = text.indexOf(IMAGE_PLACEHOLDER, index + 1);
  }
  return out;
}

/** 一本带插图的 EPUB；noiseParagraph 用来模拟夹在正文里的 base64 噪声行。 */
function imageEpub(noiseParagraph = ''): Uint8Array {
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>图纸</dc:title><dc:creator>某人</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="img/a.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
  return makeZip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': container,
    'OEBPS/content.opf': opf,
    'OEBPS/text/ch1.xhtml': `<html><body><h1>第一章 图纸</h1><p>前文</p>${noiseParagraph}<p><img src="../img/a.png"/></p><p>后文</p></body></html>`,
    'OEBPS/img/a.png': tinyPng(32, 24),
  });
}

describe('detectFormat', () => {
  it('按扩展名判断', () => {
    expect(detectFormat('书.epub', new Uint8Array())).toBe('epub');
    expect(detectFormat('书.EPUB', new Uint8Array())).toBe('epub');
    expect(detectFormat('书.pdf', new Uint8Array())).toBe('pdf');
    expect(detectFormat('书.PDF', new Uint8Array())).toBe('pdf');
    expect(detectFormat('书.txt', new Uint8Array())).toBe('txt');
    expect(detectFormat('书', new Uint8Array([0x50, 0x4b]))).toBe('txt');
  });
});

describe('combineEpubChapters', () => {
  it('拼出连续文本并给出精确区间', () => {
    const { text, chapters } = combineEpubChapters([
      { title: '第一章', text: '甲\n乙' },
      { title: '第二章', text: '丙' },
    ]);
    expect(chapters).toHaveLength(2);
    expect(text.slice(chapters[0].start, chapters[0].end)).toBe('第一章\n甲\n乙');
    expect(text.slice(chapters[1].start, chapters[1].end)).toBe('第二章\n丙');
    expect(chapters[1].start).toBeGreaterThan(chapters[0].end);
  });
});

describe('导入 EPUB', () => {
  it('解析元数据、写入正文与章节缓存', async () => {
    const { dir, store } = await setup();
    const book = await importBookBytes(store, dir, '随便起的名字.epub', sampleEpub());

    expect(book.format).toBe('epub');
    expect(book.title).toBe('山海旧事');
    expect(book.author).toBe('沈砚');
    expect(book.charCount).toBeGreaterThan(0);

    const stored = JSON.parse(await readFile(chaptersFile(dir, book.id), 'utf8')) as unknown[];
    expect(stored).toHaveLength(2);
  });

  it('打开时直接用缓存的章节，不再重新切分', async () => {
    const { dir, store } = await setup();
    const book = await importBookBytes(store, dir, 'book.epub', sampleEpub());
    const content = await loadBookContent(store, dir, book.id);

    expect(content.chapters.map((c) => c.title)).toEqual(['第一章 归途', '第二章 旧信']);
    expect(content.text).toContain('雨下了整夜。');
    // 章节区间必须与文本对得上
    const first = content.chapters[0];
    expect(content.text.slice(first.start, first.end)).toContain('第一章 归途');
  });

  it('删除书籍时章节缓存一并清掉', async () => {
    const { dir, store } = await setup();
    const book = await importBookBytes(store, dir, 'book.epub', sampleEpub());
    await removeBookContent(dir, book.id);
    await expect(readFile(chaptersFile(dir, book.id))).rejects.toThrow();
  });

  it('损坏的章节缓存会退回自动切分', async () => {
    const { dir, store } = await setup();
    const book = await importBookBytes(store, dir, 'book.epub', sampleEpub());
    await fs.writeFile(chaptersFile(dir, book.id), '不是 JSON', 'utf8');

    const content = await loadBookContent(store, dir, book.id);
    expect(content.chapters.length).toBeGreaterThan(0);
  });
});

describe('导入 TXT（回归）', () => {
  it('仍然按编码识别并自动分章', async () => {
    const { dir, store } = await setup();
    const text = '第一章 开始\n正文一\n第二章 继续\n正文二';
    const book = await importBookBytes(store, dir, '多章.txt', new TextEncoder().encode(text));

    expect(book.format).toBe('txt');
    expect(await readFile(contentFile(dir, book.id), 'utf8')).toBe(text);

    const content = await loadBookContent(store, dir, book.id);
    expect(content.chapters.map((c) => c.title)).toEqual(['第一章 开始', '第二章 继续']);
  });

  it('GBK 文件仍能正确解码', async () => {
    const { dir, store } = await setup();
    const book = await importBookBytes(store, dir, 'gbk.txt', GBK_ZHONGWEN);
    expect(book.encoding).toBe('gb18030');
    expect((await loadBookContent(store, dir, book.id)).text).toBe('中文');
  });
});

describe('导入 PDF', () => {
  it('原样保存文件，不做文字抽取，只给一个占位章节', async () => {
    const { dir, store } = await setup();
    const bytes = samplePdf();
    const book = await importBookBytes(store, dir, '《技术手册》某人.pdf', bytes);

    expect(book.format).toBe('pdf');
    expect(book.title).toBe('技术手册');
    expect(book.charCount).toBe(0);
    expect(book.pageCount).toBeUndefined();
    expect(new Uint8Array(await readFile(pdfFile(dir, book.id)))).toEqual(bytes);

    const content = await loadBookContent(store, dir, book.id);
    expect(content.text).toBe('');
    expect(content.chapters).toHaveLength(1);
    expect(content.chapters[0]).toMatchObject({ index: 0, start: 0, end: 0 });
    expect(content.images).toEqual([]);
    // 不应该写出一份空的 .txt 正文
    await expect(readFile(contentFile(dir, book.id))).rejects.toThrow();
  });

  it('读取原始字节交给渲染层，缺文件时给出可读错误', async () => {
    const { dir, store } = await setup();
    const book = await importBookBytes(store, dir, '手册.pdf', samplePdf());

    expect(new Uint8Array(await readPdfBytes(dir, book.id))).toEqual(samplePdf());

    await fs.rm(pdfFile(dir, book.id));
    await expect(readPdfBytes(dir, book.id)).rejects.toThrow('PDF 文件已丢失');
  });

  it('扩展名是 .pdf 但内容不是 PDF 时明确报错，不写坏数据', async () => {
    const { dir, store } = await setup();
    await expect(
      importBookBytes(store, dir, '假书.pdf', new TextEncoder().encode('只是一段文本')),
    ).rejects.toThrow('不是有效的 PDF 文件');
    expect(await store.list()).toEqual([]);
  });

  it('删除书籍时 pdf 文件一并清掉', async () => {
    const { dir, store } = await setup();
    const book = await importBookBytes(store, dir, '手册.pdf', samplePdf());
    await store.remove(book.id);
    await removeBookContent(dir, book.id);
    await expect(readFile(pdfFile(dir, book.id))).rejects.toThrow();
  });
});

describe('插图偏移自动对齐', () => {
  it('导入时过滤 60–79 字的噪声行，图片偏移与占位符对齐', async () => {
    const { dir, store } = await setup();
    const noise = 'A'.repeat(65);
    const book = await importBookBytes(store, dir, '图纸.epub', imageEpub(`<p>${noise}</p>`));

    const content = await loadBookContent(store, dir, book.id);
    const positions = placeholderPositions(content.text);
    expect(content.text).not.toContain(noise);
    expect(content.images).toHaveLength(1);
    expect(positions).toHaveLength(1);
    expect(content.images[0].offset).toBe(positions[0]);

    const stored = JSON.parse(await readFile(mediaFile(dir, book.id), 'utf8')) as Array<{
      offset: number;
    }>;
    expect(stored[0].offset).toBe(positions[0]);
  });

  it('旧书索引整体错位时，打开自动按占位符对齐并写回', async () => {
    const { dir, store } = await setup();
    const book = await importBookBytes(store, dir, '图纸.epub', imageEpub());
    const mediaPath = mediaFile(dir, book.id);
    const entries = JSON.parse(await readFile(mediaPath, 'utf8')) as Array<{ offset: number }>;
    // 模拟「正文清理过、索引没跟着挪」的旧数据
    await fs.writeFile(
      mediaPath,
      JSON.stringify(entries.map((entry) => ({ ...entry, offset: entry.offset + 540 }))),
      'utf8',
    );

    const content = await loadBookContent(store, dir, book.id);
    const positions = placeholderPositions(content.text);
    expect(content.images).toHaveLength(1);
    expect(content.images[0].offset).toBe(positions[0]);

    const repaired = JSON.parse(await readFile(mediaPath, 'utf8')) as Array<{ offset: number }>;
    expect(repaired[0].offset).toBe(positions[0]);
  });

  it('导入时被跳过的图片不会带偏其余图片（数量不一致也安全）', async () => {
    const { dir, store } = await setup();
    const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
    const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>缺图</dc:title></metadata>
  <manifest>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="img/a.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
    // 第一张图在包里不存在（导入时会被跳过），第二张正常
    const epub = makeZip({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': container,
      'OEBPS/content.opf': opf,
      'OEBPS/text/ch1.xhtml':
        '<html><body><p>图一</p><p><img src="../img/missing.png"/></p><p>图二</p><p><img src="../img/a.png"/></p></body></html>',
      'OEBPS/img/a.png': tinyPng(20, 10),
    });

    const book = await importBookBytes(store, dir, '缺图.epub', epub);
    const content = await loadBookContent(store, dir, book.id);
    const positions = placeholderPositions(content.text);

    expect(positions).toHaveLength(2);
    expect(content.images).toHaveLength(1);
    // 跳过的是第一张占位符，剩下这张图必须落在第二个占位符上
    expect(content.images[0].offset).toBe(positions[1]);
  });

  it('清理乱码行时图片偏移一起重映射（不会再次错位）', async () => {
    const { dir, store } = await setup();
    const noise = 'B'.repeat(65);
    const text = `开头\n${IMAGE_PLACEHOLDER}\n${noise}\n中间\n${IMAGE_PLACEHOLDER}\n结尾`;
    const oldPositions = placeholderPositions(text);
    const book: Book = {
      id: 'img-clean',
      title: '图文书',
      author: '',
      format: 'epub',
      encoding: 'utf-8',
      charCount: text.length,
      createdAt: 1,
      lastOpenedAt: null,
      sourceName: '图文书.epub',
      sourcePath: null,
    };
    await store.add(book);
    await fs.mkdir(path.dirname(contentFile(dir, book.id)), { recursive: true });
    await fs.writeFile(contentFile(dir, book.id), text, 'utf8');
    await fs.writeFile(
      mediaFile(dir, book.id),
      JSON.stringify([
        { offset: oldPositions[0], file: 'a.jpg', width: 10, height: 10 },
        { offset: oldPositions[1], file: 'b.jpg', width: 10, height: 10 },
      ]),
      'utf8',
    );

    const content = await loadBookContent(store, dir, book.id);
    const positions = placeholderPositions(content.text);
    expect(content.text).not.toContain(noise);
    expect(content.images.map((image) => image.offset)).toEqual(positions);

    const stored = JSON.parse(await readFile(mediaFile(dir, book.id), 'utf8')) as Array<{
      offset: number;
    }>;
    expect(stored.map((entry) => entry.offset)).toEqual(positions);
  });
});

describe('importBookFile（回归）', () => {
  it('从磁盘导入并记录来源路径', async () => {
    const { dir, store } = await setup();
    const srcDir = await makeTempDir('src');
    const srcFile = path.join(srcDir, '旧书.txt');
    await fs.writeFile(srcFile, '内容', 'utf8');

    const book = await importBookFile(store, dir, srcFile);
    expect(book.title).toBe('旧书');
    expect(book.sourcePath).toBe(srcFile);
  });
});
