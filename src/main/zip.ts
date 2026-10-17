import { inflateRawSync } from 'node:zlib';

/**
 * 极简 ZIP 读取器。
 *
 * 为什么不用第三方库：打包产物里不带 node_modules（打包脚本会忽略它），
 * 主进程一旦引入运行时依赖，双击 exe 就会崩。这里只用 node:zlib。
 * 支持 stored(0) 与 deflate(8)，EPUB 只用这两种。
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let offset = bytes.length - EOCD_MIN_SIZE; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function decodeName(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8').replace(/\\/g, '/');
}

export function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（找不到目录结尾）');

  const count = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (centralOffset === 0xffffffff) throw new Error('暂不支持 ZIP64 格式的 EPUB');

  const entries = new Map<string, ZipEntry>();
  let cursor = centralOffset;

  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.length) break;
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) break;

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);

    const name = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    if (!name || name.endsWith('/')) continue;

    if (localOffset + 30 > bytes.length) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue;

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      try {
        data = new Uint8Array(inflateRawSync(raw));
      } catch {
        continue;
      }
    } else {
      continue;
    }

    // 记录里解压后大小只作参考，个别 EPUB 会写错，不做强制校验
    void uncompressedSize;
    entries.set(name, { name, data });
  }

  if (entries.size === 0) throw new Error('压缩包里没有可读取的文件');
  return entries;
}

export function readZipText(entries: Map<string, ZipEntry>, name: string): string | null {
  const entry = entries.get(name);
  if (!entry) return null;
  return Buffer.from(entry.data).toString('utf8').replace(/^\uFEFF/, '');
}

/** 按大小写不敏感地查找条目（不同工具打包时大小写常不一致）。 */
export function findEntryName(entries: Map<string, ZipEntry>, target: string): string | null {
  const normalized = target.replace(/\\/g, '/').replace(/^\.\//, '');
  if (entries.has(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  for (const name of entries.keys()) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}
