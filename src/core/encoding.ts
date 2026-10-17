import type { TextEncodingName } from '../shared/types';

export interface DecodedText {
  encoding: TextEncodingName;
  text: string;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

/** 只有真的存在 BOM 才跳过对应字节，否则原文首字会被吃掉。 */
function stripBom(bytes: Uint8Array, encoding: TextEncodingName): Uint8Array {
  if (encoding === 'utf-16le') {
    return bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2) : bytes;
  }
  if (encoding === 'utf-16be') {
    return bytes[0] === 0xfe && bytes[1] === 0xff ? bytes.subarray(2) : bytes;
  }
  return startsWith(bytes, UTF8_BOM) ? bytes.subarray(UTF8_BOM.length) : bytes;
}

/** 严格解码：只要能通过就说明是合法 UTF-8。 */
export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * 无 BOM 的 UTF-16 探测：按双字节切分时，如果高位字节大量为 0，基本可以判定为 UTF-16。
 * 纯 ASCII 文本（GBK 或 UTF-8）不会出现这种 0 字节分布。
 */
function looksLikeUtf16Le(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 4096);
  if (limit < 8) return false;
  let pairs = 0;
  let zeroHigh = 0;
  for (let i = 0; i + 1 < limit; i += 2) {
    pairs += 1;
    if (bytes[i + 1] === 0 && bytes[i] !== 0) zeroHigh += 1;
  }
  return pairs > 0 && zeroHigh / pairs > 0.6;
}

function looksLikeUtf16Be(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 4096);
  if (limit < 8) return false;
  let pairs = 0;
  let zeroHigh = 0;
  for (let i = 0; i + 1 < limit; i += 2) {
    pairs += 1;
    if (bytes[i] === 0 && bytes[i + 1] !== 0) zeroHigh += 1;
  }
  return pairs > 0 && zeroHigh / pairs > 0.6;
}

/**
 * 编码识别顺序：BOM → 无 BOM 的 UTF-16 → 合法 UTF-8 → 其余按 GB18030。
 * 中文 TXT 基本只有 UTF-8 与 GBK 两类，GB18030 是 GBK 的超集，解码更宽容。
 */
export function detectEncoding(bytes: Uint8Array): TextEncodingName {
  if (bytes.length === 0) return 'utf-8';
  if (startsWith(bytes, UTF8_BOM)) {
    return isValidUtf8(bytes.subarray(UTF8_BOM.length)) ? 'utf-8' : 'gb18030';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  // 无 BOM 的 UTF-16 必须先判：它的字节序列常常「恰好」是合法 UTF-8（NUL 是合法字符）
  if (looksLikeUtf16Le(bytes)) return 'utf-16le';
  if (looksLikeUtf16Be(bytes)) return 'utf-16be';
  if (isValidUtf8(bytes)) return 'utf-8';
  return 'gb18030';
}

/** 统一换行符，后续所有按行处理都假设只有 \n。 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function stripBomChar(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function decodeText(bytes: Uint8Array): DecodedText {
  const encoding = detectEncoding(bytes);
  const body = stripBom(bytes, encoding);
  const text = new TextDecoder(encoding).decode(body);
  return { encoding, text: normalizeNewlines(stripBomChar(text)) };
}

/** 把 HTML/XML 里声明的编码标签收敛成 TextDecoder 认识的名字；不认识返回 null。 */
function normalizeMarkupLabel(label: string | undefined): string | null {
  if (!label) return null;
  const value = label.trim().toLowerCase();
  if (!value) return null;
  if (value === 'utf8' || value === 'utf-8') return 'utf-8';
  if (value === 'utf16' || value === 'utf-16') return 'utf-16le';
  if (value === 'utf-16be') return 'utf-16be';
  if (value === 'gb2312' || value === 'gbk' || value === 'gb18030' || value === 'x-gbk') {
    return 'gb18030';
  }
  if (/^[a-z0-9._-]+$/.test(value)) return value;
  return null;
}

function tryDecode(bytes: Uint8Array, label: string): string | null {
  try {
    // UTF-8 用严格模式：声明错了就退回自动识别
    const decoder =
      label === 'utf-8'
        ? new TextDecoder(label, { fatal: true })
        : new TextDecoder(label);
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 解码 EPUB 里的 XHTML：先看 BOM，再看 XML 声明 / meta charset，
 * 最后退回和 TXT 一样的自动识别。之前一律按 UTF-8，声明了别的编码的书就整章乱码。
 */
export function decodeMarkup(bytes: Uint8Array): { encoding: string; text: string } {
  if (bytes.length === 0) return { encoding: 'utf-8', text: '' };
  if (startsWith(bytes, UTF8_BOM)) {
    return { encoding: 'utf-8', text: normalizeNewlines(stripBomChar(new TextDecoder('utf-8').decode(bytes.subarray(3)))) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      encoding: 'utf-16le',
      text: normalizeNewlines(stripBomChar(new TextDecoder('utf-16le').decode(bytes.subarray(2)))),
    };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      encoding: 'utf-16be',
      text: normalizeNewlines(stripBomChar(new TextDecoder('utf-16be').decode(bytes.subarray(2)))),
    };
  }

  const head = new TextDecoder('iso-8859-1').decode(bytes.subarray(0, 2048));
  const declared =
    /encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1] ??
    /charset\s*=\s*["']?([\w.-]+)/i.exec(head)?.[1];
  const label = normalizeMarkupLabel(declared);
  if (label) {
    const decoded = tryDecode(bytes, label);
    if (decoded !== null) {
      return { encoding: label, text: normalizeNewlines(stripBomChar(decoded)) };
    }
  }

  const fallback = decodeText(bytes);
  return { encoding: fallback.encoding, text: fallback.text };
}
