import { decodeEntities } from '../core/xml';
import { IMAGE_PLACEHOLDER } from '../core/images';
import { isNoiseLine } from '../core/textclean';

export { IMAGE_PLACEHOLDER };

/**
 * XHTML → 纯文本。
 *
 * 之前用正则剥标签，属性值里出现 `>` 就会把标签从中间截断，剩下的半截（常见于
 * data URI、base64 字体、alt 文本）会混进正文，看起来就是「乱码」。
 * 这里改成逐字符扫描：标签内的引号状态会被跟踪，闭合标签、注释、CDATA、
 * script/style/head 都能正确跳过。
 */

/** 块级标签：遇到就断段。 */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'tr',
  'section',
  'article',
  'blockquote',
  'pre',
  'table',
  'ul',
  'ol',
  'figure',
  'figcaption',
  'hr',
  'br',
]);

/** 整段跳过内容的标签。 */
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title']);

/** 只有 base64 字符集、又长又没有任何空格的长行，基本可以判定是编码残留。 */
// 规则与旧书清理（core/textclean.ts 的 isNoiseLine）保持一致：
// 之前这里是 80 字、清理是 60 字，60–79 字的噪声行会「导入时留下、打开时删掉」，
// 正文一变短，图片索引就对不上了。
function looksLikeBase64Noise(line: string): boolean {
  return isNoiseLine(line);
}

/** 从标签文本里取属性值（支持双引号、单引号、无引号）。 */
function attribute(tag: string, name: string): string {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const matched = pattern.exec(tag);
  if (!matched) return '';
  return decodeEntities(matched[2] ?? matched[3] ?? matched[4] ?? '');
}

export interface HtmlTextResult {
  text: string;
  /** 与占位符顺序一致的 img src（文中原始相对路径，尚未解析）。 */
  imageSrcs: string[];
}

export interface HtmlTextOptions {
  /** 是否把 <img> 换成占位符（导入带图的书时开启）。 */
  imagePlaceholder?: boolean;
}

export function extractHtmlText(
  html: string,
  options: HtmlTextOptions = {},
): HtmlTextResult {
  const withPlaceholder = options.imagePlaceholder === true;
  const paragraphs: string[] = [];
  const imageSrcs: string[] = [];
  let current = '';
  let index = 0;
  const length = html.length;

  const flush = (): void => {
    // 源码里的换行和缩进只是 HTML 的排版空白，不是段落边界：
    // 不折叠的话，被源码换行排版的公式/句子会在正文里一行一个片段。
    const line = current.replace(/\s+/g, ' ').trim();
    current = '';
    if (!line || looksLikeBase64Noise(line)) return;
    paragraphs.push(line);
  };

  while (index < length) {
    if (html[index] !== '<') {
      const next = html.indexOf('<', index);
      const end = next === -1 ? length : next;
      current += decodeEntities(html.slice(index, end));
      index = end;
      continue;
    }

    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4);
      index = end === -1 ? length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', index)) {
      const end = html.indexOf(']]>', index + 9);
      current += html.slice(index + 9, end === -1 ? length : end);
      index = end === -1 ? length : end + 3;
      continue;
    }
    if (html.startsWith('<!', index) || html.startsWith('<?', index)) {
      const end = html.indexOf('>', index + 2);
      index = end === -1 ? length : end + 1;
      continue;
    }

    // 扫描到标签结束；引号里的 > 不算结束
    let cursor = index + 1;
    let quote: string | null = null;
    while (cursor < length) {
      const char = html[cursor];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
      cursor += 1;
    }
    const tag = html.slice(index, Math.min(cursor + 1, length));
    const name = (/^<\s*\/?\s*([a-zA-Z][\w:-]*)/.exec(tag)?.[1] ?? '').toLowerCase();
    const closing = /^<\s*\//.test(tag);
    index = cursor + 1;

    if (SKIP_TAGS.has(name) && !closing) {
      const closeAt = html.toLowerCase().indexOf(`</${name}`, index);
      if (closeAt === -1) break;
      const closeEnd = html.indexOf('>', closeAt);
      index = closeEnd === -1 ? length : closeEnd + 1;
      continue;
    }

    if (name === 'img') {
      flush();
      if (withPlaceholder) {
        const src = attribute(tag, 'src');
        if (src) {
          imageSrcs.push(src);
          paragraphs.push(IMAGE_PLACEHOLDER);
        }
      }
      continue;
    }

    if (BLOCK_TAGS.has(name)) flush();
  }

  flush();
  return { text: paragraphs.join('\n'), imageSrcs };
}

export function htmlToText(html: string): string {
  return extractHtmlText(html).text;
}
