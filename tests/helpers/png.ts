/** 只含 PNG 文件头与 IHDR 的最小字节，imageSize 能读出宽高。 */
export function tinyPng(width = 16, height = 16): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(out.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return out;
}
