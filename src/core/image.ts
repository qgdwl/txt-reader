/**
 * 从图片文件头里读出宽高。
 *
 * 只为了导入时记下尺寸，好在正文里提前占位（图片还没加载也不会跳版）。
 * 支持 EPUB 里最常见的 PNG / JPEG / GIF / WebP；认不出来返回 null。
 */

export interface ImageSize {
  width: number;
  height: number;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(bytes[offset + i] ?? 0);
  return text;
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function uint16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function pngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || ascii(bytes, 1, 3) !== 'PNG') return null;
  const width = uint32be(bytes, 16);
  const height = uint32be(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    // SOF0..SOF15，排除 DHT(C4)、JPG(C8)、DAC(CC)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = uint16be(bytes, offset + 5);
      const width = uint16be(bytes, offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const length = uint16be(bytes, offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function gifSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 10) return null;
  const header = ascii(bytes, 0, 3);
  if (header !== 'GIF') return null;
  const width = uint16le(bytes, 6);
  const height = uint16le(bytes, 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function webpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    const width = uint16le(bytes, 26) & 0x3fff;
    const height = uint16le(bytes, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === 'VP8L') {
    const bits = (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (chunk === 'VP8X') {
    const width = uint24le(bytes, 24) + 1;
    const height = uint24le(bytes, 27) + 1;
    return { width, height };
  }
  return null;
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 12) return null;
  return pngSize(bytes) ?? jpegSize(bytes) ?? gifSize(bytes) ?? webpSize(bytes);
}
