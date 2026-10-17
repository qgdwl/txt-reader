import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * 极简 ZIP 写入器。
 *
 * 为什么不直接调系统 tar / Compress-Archive：Windows 上的 bsdtar 会把中文文件名
 * 按本地代码页写进压缩包，别人解压出来就是乱码；Windows PowerShell 5.1 的
 * .NET 实现又不会设置「UTF-8 文件名」标志位。这里自己写，统一用 UTF-8 + 标志位 0x800，
 * 保证任何语言环境的 Windows 解压出来文件名都正确。
 *
 * 只支持 stored 之外的 deflate（8），不支持 ZIP64（本项目产物远小于 4GB）。
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const VERSION = 20;
const METHOD_DEFLATE = 8;
const UTF8_FLAG = 0x800;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  const native = (zlib as unknown as { crc32?: (data: Buffer) => number }).crc32;
  if (typeof native === 'function') return native(bytes) >>> 0;
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function toDosTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

export interface ZipDirectoryOptions {
  /** 要压缩的目录（其下的文件会以相对路径进包）。 */
  sourceDir: string;
  /** 包内顶层目录名，留空则文件直接在根。 */
  prefix?: string;
  /** 输出文件路径。 */
  outputPath: string;
  /** 需要跳过的相对路径（目录或文件），用 / 分隔。 */
  exclude?: readonly string[];
}

export interface ZipDirectoryResult {
  entries: number;
  bytes: number;
}

export function zipDirectory(options: ZipDirectoryOptions): ZipDirectoryResult {
  const { sourceDir, outputPath } = options;
  const prefix = options.prefix ?? '';
  const exclude = options.exclude ?? [];

  const files: Array<{ absolute: string; relative: string }> = [];
  const walk = (dir: string, relative: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (exclude.some((item) => childRelative === item || childRelative.startsWith(`${item}/`))) {
        continue;
      }
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, childRelative);
      else if (entry.isFile()) files.push({ absolute, relative: childRelative });
    }
  };
  walk(sourceDir, '');
  files.sort((a, b) => a.relative.localeCompare(b.relative));

  const fd = fs.openSync(outputPath, 'w');
  let offset = 0;
  const central: Array<{
    name: Buffer;
    crc: number;
    compressed: number;
    size: number;
    time: number;
    date: number;
    localOffset: number;
  }> = [];

  try {
    for (const file of files) {
      const data = fs.readFileSync(file.absolute);
      const name = Buffer.from(prefix ? `${prefix}/${file.relative}` : file.relative, 'utf8');
      const compressed = zlib.deflateRawSync(data, { level: 6 });
      const stamp = toDosTime(fs.statSync(file.absolute).mtime);
      const crc = crc32(data);

      const header = Buffer.alloc(30);
      header.writeUInt32LE(LOCAL_SIGNATURE, 0);
      header.writeUInt16LE(VERSION, 4);
      header.writeUInt16LE(UTF8_FLAG, 6);
      header.writeUInt16LE(METHOD_DEFLATE, 8);
      header.writeUInt16LE(stamp.time, 10);
      header.writeUInt16LE(stamp.date, 12);
      header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(compressed.length, 18);
      header.writeUInt32LE(data.length, 22);
      header.writeUInt16LE(name.length, 26);
      header.writeUInt16LE(0, 28);

      fs.writeSync(fd, header);
      fs.writeSync(fd, name);
      fs.writeSync(fd, compressed);

      central.push({
        name,
        crc,
        compressed: compressed.length,
        size: data.length,
        time: stamp.time,
        date: stamp.date,
        localOffset: offset,
      });
      offset += header.length + name.length + compressed.length;
    }

    const centralStart = offset;
    for (const entry of central) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(CENTRAL_SIGNATURE, 0);
      record.writeUInt16LE(VERSION, 4);
      record.writeUInt16LE(VERSION, 6);
      record.writeUInt16LE(UTF8_FLAG, 8);
      record.writeUInt16LE(METHOD_DEFLATE, 10);
      record.writeUInt16LE(entry.time, 12);
      record.writeUInt16LE(entry.date, 14);
      record.writeUInt32LE(entry.crc, 16);
      record.writeUInt32LE(entry.compressed, 20);
      record.writeUInt32LE(entry.size, 24);
      record.writeUInt16LE(entry.name.length, 28);
      record.writeUInt16LE(0, 30);
      record.writeUInt16LE(0, 32);
      record.writeUInt16LE(0, 34);
      record.writeUInt16LE(0, 36);
      record.writeUInt32LE(0, 38);
      record.writeUInt32LE(entry.localOffset, 42);
      fs.writeSync(fd, record);
      fs.writeSync(fd, entry.name);
      offset += record.length + entry.name.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(offset - centralStart, 12);
    eocd.writeUInt32LE(centralStart, 16);
    eocd.writeUInt16LE(0, 20);
    fs.writeSync(fd, eocd);
    offset += eocd.length;
  } finally {
    fs.closeSync(fd);
  }

  return { entries: files.length, bytes: offset };
}
