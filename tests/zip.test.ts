import { describe, expect, it } from 'vitest';
import { findEntryName, readZip, readZipText } from '../src/main/zip';
import { makeZip } from './helpers/zip';

describe('readZip', () => {
  it('能读出 stored 条目', () => {
    const zip = makeZip({ 'mimetype': 'application/epub+zip', 'META-INF/container.xml': '<x/>' });
    const entries = readZip(zip);
    expect([...entries.keys()].sort()).toEqual(['META-INF/container.xml', 'mimetype']);
  });

  it('按路径取文本', () => {
    const zip = makeZip({ 'a/b.txt': '中文内容' });
    const entries = readZip(zip);
    expect(readZipText(entries, 'a/b.txt')).toBe('中文内容');
  });

  it('支持二进制内容', () => {
    const data = new Uint8Array([0, 1, 2, 255]);
    const zip = makeZip({ 'bin.dat': data });
    const entries = readZip(zip);
    expect([...(entries.get('bin.dat')?.data ?? [])]).toEqual([0, 1, 2, 255]);
  });

  it('非 ZIP 数据抛错', () => {
    expect(() => readZip(new Uint8Array([1, 2, 3, 4, 5]))).toThrow('不是有效的 ZIP');
  });

  it('空压缩包抛错', () => {
    const zip = makeZip({});
    expect(() => readZip(zip)).toThrow();
  });
});

describe('findEntryName', () => {
  const entries = readZip(makeZip({ 'OEBPS/Content.opf': 'x', 'a/b.xhtml': 'y' }));

  it('精确匹配', () => {
    expect(findEntryName(entries, 'a/b.xhtml')).toBe('a/b.xhtml');
  });

  it('大小写不敏感', () => {
    expect(findEntryName(entries, 'oebps/content.opf')).toBe('OEBPS/Content.opf');
  });

  it('容忍反斜杠与 ./ 前缀', () => {
    expect(findEntryName(entries, './a\\b.xhtml')).toBe('a/b.xhtml');
  });

  it('找不到返回 null', () => {
    expect(findEntryName(entries, 'missing.txt')).toBeNull();
  });
});

describe('readZipText', () => {
  it('去掉 BOM', () => {
    const zip = makeZip({ 'bom.txt': '\uFEFFhello' });
    expect(readZipText(readZip(zip), 'bom.txt')).toBe('hello');
  });

  it('条目不存在返回 null', () => {
    const entries = readZip(makeZip({ 'a.txt': 'x' }));
    expect(readZipText(entries, 'b.txt')).toBeNull();
  });
});
