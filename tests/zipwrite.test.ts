import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { zipDirectory } from '../src/main/zipwrite';
import { readZip } from '../src/main/zip';
import { makeTempDir } from './helpers/tmp';

/** 中央目录里每条记录的通用标志位（第 8 字节起）必须带 0x800 = UTF-8 文件名。 */
function utf8Flags(zipPath: string): number[] {
  const bytes = fs.readFileSync(zipPath);
  const flags: number[] = [];
  for (let offset = 0; offset < bytes.length - 4; offset += 1) {
    if (bytes.readUInt32LE(offset) === 0x02014b50) {
      flags.push(bytes.readUInt16LE(offset + 8));
    }
  }
  return flags;
}

describe('zipDirectory', () => {
  it('中文文件名用 UTF-8 写入并带标志位，内容可读回', async () => {
    const dir = await makeTempDir('zipwrite');
    fs.mkdirSync(path.join(dir, '子目录'), { recursive: true });
    fs.writeFileSync(path.join(dir, '子目录', '中文.txt'), '你好，世界', 'utf8');
    fs.writeFileSync(path.join(dir, 'plain.txt'), 'hello', 'utf8');
    const zipPath = path.join(dir, 'out.zip');

    const result = zipDirectory({
      sourceDir: dir,
      prefix: '包',
      outputPath: zipPath,
      exclude: ['out.zip'],
    });

    expect(result.entries).toBe(2);
    expect(result.bytes).toBe(fs.statSync(zipPath).size);

    const entries = readZip(new Uint8Array(fs.readFileSync(zipPath)));
    expect([...entries.keys()].sort()).toEqual(['包/plain.txt', '包/子目录/中文.txt']);
    expect(Buffer.from(entries.get('包/子目录/中文.txt')?.data ?? []).toString('utf8')).toBe('你好，世界');
    expect(Buffer.from(entries.get('包/plain.txt')?.data ?? []).toString('utf8')).toBe('hello');

    const flags = utf8Flags(zipPath);
    expect(flags).toHaveLength(2);
    for (const flag of flags) expect(flag & 0x800).toBe(0x800);
  });

  it('exclude 指定的目录不会进包', async () => {
    const dir = await makeTempDir('zipwrite-exclude');
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data', 'secret.txt'), 'x', 'utf8');
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'y', 'utf8');
    const zipPath = path.join(dir, 'out.zip');

    zipDirectory({ sourceDir: dir, outputPath: zipPath, exclude: ['data', 'out.zip'] });

    const entries = readZip(new Uint8Array(fs.readFileSync(zipPath)));
    expect([...entries.keys()]).toEqual(['keep.txt']);
  });

  it('空目录生成一个合法但无条目的压缩包', async () => {
    const dir = await makeTempDir('zipwrite-empty');
    const zipPath = path.join(dir, 'empty.zip');
    const result = zipDirectory({ sourceDir: dir, outputPath: zipPath, exclude: ['empty.zip'] });
    expect(result.entries).toBe(0);
    const bytes = fs.readFileSync(zipPath);
    // 末尾 22 字节是目录结尾记录（EOCD），条目数为 0
    expect(bytes.length).toBe(22);
    expect(bytes.readUInt32LE(0)).toBe(0x06054b50);
    expect(bytes.readUInt16LE(10)).toBe(0);
    expect(() => readZip(new Uint8Array(bytes))).toThrow();
  });
});
