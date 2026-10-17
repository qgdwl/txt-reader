export interface BookMeta {
  title: string;
  author: string;
}

const DECORATION =
  /[【\[（(](?:全本|完结|完本|全集|精选|精校|校对|无删减|手打|下载|共享|上部|下部|txt|TXT)[】\]）)]/g;

function cleanPart(value: string): string {
  return value
    .replace(DECORATION, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-—–_.·]+/, '')
    .replace(/[\s\-—–_.·]+$/, '')
    .trim();
}

function cleanAuthor(value: string): string {
  return cleanPart(value)
    .replace(/^(?:作者|著者|作\s*者)\s*[:：]\s*/, '')
    .replace(/\s*(?:著|编著|编写|译)\s*$/, '')
    .trim();
}

/**
 * 从文件名猜书名与作者。常见形态：
 * 《书名》作者.txt / 《书名》.txt / 书名(作者).txt / 书名 - 作者.txt / 书名 by 作者.txt
 */
export function parseFileName(rawName: string): BookMeta {
  const withoutDir = rawName.replace(/^.*[\\/]/, '');
  const base = withoutDir.replace(/\.[^./\\]+$/, '');
  const stripped = cleanPart(base);
  if (!stripped) return { title: base.trim() || '未命名', author: '' };

  const bookTitle = stripped.match(/^《([^》]+)》\s*(.*)$/);
  if (bookTitle) {
    const title = cleanPart(bookTitle[1]) || bookTitle[1].trim();
    return { title: title || '未命名', author: cleanAuthor(bookTitle[2]) };
  }

  const wrap = stripped.match(/^【([^】]+)】\s*(.*)$/);
  if (wrap) {
    const title = cleanPart(wrap[1]) || wrap[1].trim();
    return { title: title || '未命名', author: cleanAuthor(wrap[2]) };
  }

  const paren = stripped.match(/^(.+?)\s*[（(]([^（）()]{1,30})[）)]\s*$/);
  if (paren) {
    const title = cleanPart(paren[1]);
    const inner = cleanPart(paren[2]);
    if (title && inner && !/^\d+$/.test(inner)) {
      return { title, author: cleanAuthor(inner) };
    }
  }

  const byAuthor = stripped.match(/^(.+?)\s*(?:[-_—–]\s*)?(?:by|作者\s*[:：])\s*(.+)$/i);
  if (byAuthor) {
    const title = cleanPart(byAuthor[1]);
    const author = cleanAuthor(byAuthor[2]);
    if (title && author) return { title, author };
  }

  return { title: cleanPart(stripped) || '未命名', author: '' };
}

/** 文件名没给出作者时，从前几行找「作者：xxx」。 */
export function detectAuthorFromText(text: string): string {
  const head = text.slice(0, 4000);
  const match = head.match(/作\s*者\s*[:：]\s*([^\n]{1,40})/);
  return match ? cleanAuthor(match[1]) : '';
}

/** 结合文件名与正文推断元数据：文件名优先，缺作者时再看正文。 */
export function resolveBookMeta(fileName: string, text: string): BookMeta {
  const fromName = parseFileName(fileName);
  if (fromName.author) return fromName;
  return { title: fromName.title, author: detectAuthorFromText(text) };
}
