import { attr, findAll, findFirst, parseXml, trimmedText } from '../core/xml';
import { decodeMarkup } from '../core/encoding';
import { imageSize } from '../core/image';
import { IMAGE_PLACEHOLDER } from '../core/images';
import { extractHtmlText, htmlToText } from './html-text';
import { findEntryName, readZip } from './zip';

export { htmlToText, IMAGE_PLACEHOLDER };

/** 单张图片的上限：超过就跳过，避免一张巨图拖垮导入和阅读。 */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
/** 一本书里图片总量上限。 */
export const MAX_MEDIA_TOTAL = 300 * 1024 * 1024;

export interface EpubImage {
  /** 占位符在这章正文（chapter.text）里的位置。 */
  offset: number;
  /** 原文件名（含扩展名）。 */
  fileName: string;
  data: Uint8Array;
  width: number;
  height: number;
}

export interface EpubChapter {
  title: string;
  /** 纯文本正文，段落之间用单个换行分隔；图片位置是 IMAGE_PLACEHOLDER。 */
  text: string;
  /** 本章图片；老调用方可能不传，按「没有图片」处理。 */
  images?: EpubImage[];
}

export interface ParsedEpub {
  title: string;
  author: string;
  chapters: EpubChapter[];
  /** 被跳过的大图/坏图数量，导入时可以提示用户。 */
  skippedImages: number;
}

/** 读包内的 XML/XHTML 并按它自己声明的编码解码（老版本一律当 UTF-8）。 */
function readMarkup(
  entries: Map<string, { name: string; data: Uint8Array }>,
  name: string,
): string | null {
  const entry = entries.get(name);
  return entry ? decodeMarkup(entry.data).text : null;
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

/** 把相对 href 解析成包内绝对路径，并去掉锚点。 */
export function resolveHref(baseDir: string, href: string): string {
  const clean = href.split('#')[0].trim().replace(/\\/g, '/');
  if (!clean) return '';
  const parts = `${baseDir ? `${baseDir}/` : ''}${clean}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function headingTitle(html: string): string {
  const match = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (!match) return '';
  return htmlToText(match[1]).replace(/\n/g, ' ').trim();
}

/** 正文开头的标题行去掉：标题由章节元数据承载，正文里再来一次就重复了。 */
function dropLeadingHeading(text: string, title: string): string {
  const breakAt = text.indexOf('\n');
  const firstLine = (breakAt === -1 ? text : text.slice(0, breakAt)).trim();
  if (firstLine && firstLine === title.trim()) {
    return breakAt === -1 ? '' : text.slice(breakAt + 1);
  }
  return text;
}

function tocFromNav(navHtml: string, navDir: string): Map<string, string> {  const map = new Map<string, string>();
  const nav = parseXml(navHtml);
  for (const anchor of findAll(nav, 'a')) {
    const href = attr(anchor, 'href');
    const label = trimmedText(anchor);
    if (!href || !label) continue;
    const path = resolveHref(navDir, href);
    if (path && !map.has(path)) map.set(path, label);
  }
  return map;
}

function tocFromNcx(ncxXml: string, ncxDir: string): Map<string, string> {
  const map = new Map<string, string>();
  const ncx = parseXml(ncxXml);
  for (const point of findAll(ncx, 'navPoint')) {
    const content = findFirst(point, 'content');
    const src = attr(content, 'src');
    const label = trimmedText(findFirst(point, 'text')) || trimmedText(findFirst(point, 'navLabel'));
    if (!src || !label) continue;
    const path = resolveHref(ncxDir, src);
    if (path && !map.has(path)) map.set(path, label);
  }
  return map;
}

/**
 * 解析 EPUB 为「标题 + 作者 + 章节纯文本」。
 *
 * 只做这一层是刻意的：阅读器内部统一用纯文本 + 锚点分页，
 * 图片和 CSS 暂不支持，但正文、目录、章节顺序都能正确拿到。
 */
export function parseEpub(bytes: Uint8Array): ParsedEpub {
  const entries = readZip(bytes);

  const containerName = findEntryName(entries, 'META-INF/container.xml');
  if (!containerName) throw new Error('缺少 META-INF/container.xml，不是有效的 EPUB');
  const container = parseXml(readMarkup(entries, containerName) ?? '');
  const opfPath = attr(findFirst(container, 'rootfile'), 'full-path');
  if (!opfPath) throw new Error('container.xml 里没有 rootfile');

  const opfName = findEntryName(entries, opfPath);
  if (!opfName) throw new Error(`找不到 OPF 文件：${opfPath}`);
  const opfDir = dirname(opfName);
  const opf = parseXml(readMarkup(entries, opfName) ?? '');
  if (!opf) throw new Error('OPF 解析失败');

  const metadata = findFirst(opf, 'metadata');
  const title = trimmedText(findFirst(metadata, 'title'));
  const author = trimmedText(findFirst(metadata, 'creator'));

  interface ManifestItem {
    path: string;
    mediaType: string;
    properties: string;
  }
  const manifest = new Map<string, ManifestItem>();
  for (const item of findAll(findFirst(opf, 'manifest'), 'item')) {
    const id = attr(item, 'id');
    const href = attr(item, 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      path: resolveHref(opfDir, href),
      mediaType: attr(item, 'media-type') ?? '',
      properties: attr(item, 'properties') ?? '',
    });
  }

  let toc = new Map<string, string>();
  const navItem = [...manifest.values()].find((item) => /(^|\s)nav(\s|$)/.test(item.properties));
  if (navItem) {
    const navName = findEntryName(entries, navItem.path);
    if (navName) toc = tocFromNav(readMarkup(entries, navName) ?? '', dirname(navName));
  }
  if (toc.size === 0) {
    const ncxItem = [...manifest.values()].find(
      (item) => item.mediaType === 'application/x-dtbncx+xml',
    );
    if (ncxItem) {
      const ncxName = findEntryName(entries, ncxItem.path);
      if (ncxName) toc = tocFromNcx(readMarkup(entries, ncxName) ?? '', dirname(ncxName));
    }
  }

  const spine = findFirst(opf, 'spine');
  const chapters: EpubChapter[] = [];
  const seen = new Set<string>();
  let ordinal = 0;
  let mediaTotal = 0;
  let skippedImages = 0;

  for (const itemref of findAll(spine, 'itemref')) {
    const idref = attr(itemref, 'idref');
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item) continue;
    if (item.mediaType && !/x?html|xml/.test(item.mediaType)) continue;

    const entryName = findEntryName(entries, item.path);
    if (!entryName) continue;

    const html = readMarkup(entries, entryName) ?? '';
    const baseDir = dirname(entryName);
    const extracted = extractHtmlText(html, { imagePlaceholder: true });
    const text = extracted.text;
    if (!text) continue;

    const key = `${item.path}|${toc.get(item.path) ?? headingTitle(html)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    ordinal += 1;
    const chapterTitle = toc.get(item.path) || headingTitle(html) || `第 ${ordinal} 节`;
    const body = dropLeadingHeading(text, chapterTitle);
    const images: EpubImage[] = [];
    let imageIndex = 0;
    for (let offset = 0; offset < body.length; offset += 1) {
      if (body[offset] !== IMAGE_PLACEHOLDER) continue;
      const src = extracted.imageSrcs[imageIndex];
      imageIndex += 1;
      if (!src) continue;
      const resolved = resolveHref(baseDir, src);
      const imageName = findEntryName(entries, resolved);
      const entry = imageName ? entries.get(imageName) : undefined;
      if (!entry) {
        skippedImages += 1;
        continue;
      }
      const size = imageSize(entry.data);
      if (!size || entry.data.length > MAX_IMAGE_BYTES || mediaTotal + entry.data.length > MAX_MEDIA_TOTAL) {
        skippedImages += 1;
        continue;
      }
      mediaTotal += entry.data.length;
      images.push({
        offset,
        fileName: (imageName ?? '').split('/').pop() ?? `image-${images.length + 1}.jpg`,
        data: entry.data,
        width: size.width,
        height: size.height,
      });
    }

    chapters.push({ title: chapterTitle, text: body, images });
  }

  if (chapters.length === 0) throw new Error('EPUB 里没有可阅读的正文');
  return { title: title || '未命名', author, chapters, skippedImages };
}
