import { describe, expect, it } from 'vitest';
import { decodeMarkup, decodeText, detectEncoding, isValidUtf8 } from '../src/core/encoding';

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// GBK 编码的「中文」
const GBK_ZHONGWEN = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);

describe('detectEncoding', () => {
  it('识别带 BOM 的 UTF-8', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes('你好')]);
    expect(detectEncoding(bytes)).toBe('utf-8');
  });

  it('识别带 BOM 的 UTF-16LE', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e]);
    expect(detectEncoding(bytes)).toBe('utf-16le');
  });

  it('识别带 BOM 的 UTF-16BE', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x4e, 0x2d]);
    expect(detectEncoding(bytes)).toBe('utf-16be');
  });

  it('合法 UTF-8 判为 utf-8', () => {
    expect(detectEncoding(utf8Bytes('第一章 测试'))).toBe('utf-8');
  });

  it('GBK 字节判为 gb18030', () => {
    expect(detectEncoding(GBK_ZHONGWEN)).toBe('gb18030');
  });

  it('无 BOM 的 UTF-16LE 也能识别', () => {
    const bytes = new Uint8Array([0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x44, 0x00]);
    expect(detectEncoding(bytes)).toBe('utf-16le');
  });

  it('空文件按 utf-8 处理', () => {
    expect(detectEncoding(new Uint8Array())).toBe('utf-8');
  });

  it('BOM 之后不是合法 UTF-8 时回退到 gb18030', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xd6, 0xd0, 0xce, 0xc4]);
    expect(detectEncoding(bytes)).toBe('gb18030');
  });
});

describe('isValidUtf8', () => {
  it('区分 UTF-8 与 GBK 字节', () => {
    expect(isValidUtf8(utf8Bytes('中文'))).toBe(true);
    expect(isValidUtf8(GBK_ZHONGWEN)).toBe(false);
  });
});

describe('decodeText', () => {
  it('解码 UTF-8 并去掉 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes('你好')]);
    expect(decodeText(bytes)).toEqual({ encoding: 'utf-8', text: '你好' });
  });

  it('解码 GBK', () => {
    expect(decodeText(GBK_ZHONGWEN)).toEqual({ encoding: 'gb18030', text: '中文' });
  });

  it('解码 UTF-16LE', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]);
    expect(decodeText(bytes)).toEqual({ encoding: 'utf-16le', text: '中文' });
  });

  it('统一换行符', () => {
    const bytes = utf8Bytes('第一行\r\n第二行\r第三行');
    expect(decodeText(bytes).text).toBe('第一行\n第二行\n第三行');
  });

  it('空文件得到空字符串', () => {
    expect(decodeText(new Uint8Array())).toEqual({ encoding: 'utf-8', text: '' });
  });
});

describe('decodeMarkup', () => {
  it('按 XML 声明里的编码解码', () => {
    const bytes = new Uint8Array([
      ...utf8Bytes('<?xml version="1.0" encoding="gb2312"?><p>'),
      ...GBK_ZHONGWEN,
      ...utf8Bytes('</p>'),
    ]);
    const result = decodeMarkup(bytes);
    expect(result.encoding).toBe('gb18030');
    expect(result.text).toContain('中文');
  });

  it('按 meta charset 解码', () => {
    const bytes = new Uint8Array([
      ...utf8Bytes('<meta charset="gbk"><p>'),
      ...GBK_ZHONGWEN,
      ...utf8Bytes('</p>'),
    ]);
    expect(decodeMarkup(bytes).text).toContain('中文');
  });

  it('UTF-8 优先按声明解码', () => {
    const bytes = utf8Bytes('<?xml version="1.0" encoding="utf-8"?><p>中文</p>');
    const result = decodeMarkup(bytes);
    expect(result.encoding).toBe('utf-8');
    expect(result.text).toContain('中文');
  });

  it('没有声明时自动识别 GBK', () => {
    const bytes = new Uint8Array([...utf8Bytes('<p>'), ...GBK_ZHONGWEN, ...utf8Bytes('</p>')]);
    expect(decodeMarkup(bytes).text).toContain('中文');
  });

  it('UTF-16LE BOM 优先', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]);
    expect(decodeMarkup(bytes)).toEqual({ encoding: 'utf-16le', text: '中文' });
  });

  it('空内容返回空串', () => {
    expect(decodeMarkup(new Uint8Array())).toEqual({ encoding: 'utf-8', text: '' });
  });
});
