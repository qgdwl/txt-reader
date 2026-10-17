import { describe, expect, it } from 'vitest';
import { imageSize } from '../src/core/image';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

function png(width: number, height: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  out.set(ascii('IHDR'), 12);
  new DataView(out.buffer).setUint32(16, width);
  new DataView(out.buffer).setUint32(20, height);
  return out;
}

describe('imageSize', () => {
  it('读 PNG 尺寸', () => {
    expect(imageSize(png(600, 900))).toEqual({ width: 600, height: 900 });
  });

  it('读 JPEG 尺寸', () => {
    // FFD8 + APP0 段 + SOF0（宽 800 高 600）
    const out = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x00, 0x00, 0x00,
    ]);
    expect(imageSize(out)).toEqual({ width: 800, height: 600 });
  });

  it('读 GIF 尺寸', () => {
    const out = new Uint8Array([...ascii('GIF89a'), 0x90, 0x01, 0x2c, 0x01, 0, 0, 0]);
    expect(imageSize(out)).toEqual({ width: 400, height: 300 });
  });

  it('读 WebP（VP8X）尺寸', () => {
    const out = new Uint8Array(30);
    out.set(ascii('RIFF'), 0);
    out.set([0, 0, 0, 0], 4);
    out.set(ascii('WEBP'), 8);
    out.set(ascii('VP8X'), 12);
    out.set([0, 0, 0, 0], 16);
    out.set([0x57, 0x02, 0x00], 24); // 宽 600 - 1
    out.set([0x83, 0x03, 0x00], 27); // 高 900 - 1
    expect(imageSize(out)).toEqual({ width: 600, height: 900 });
  });

  it('认不出来返回 null', () => {
    expect(imageSize(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toBeNull();
    expect(imageSize(bytes())).toBeNull();
  });
});
