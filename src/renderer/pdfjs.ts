import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/**
 * pdf.js 的初始化。
 *
 * 用 legacy 构建：Electron 33 是 Chromium 130，缺少 pdf.js 6 依赖的
 * `Uint8Array.prototype.toHex`（Chrome 133 才有），标准构建会在打开 PDF 时抛错；
 * legacy 构建自带这组 polyfill。
 *
 * worker 由 pdf.js 自己创建：开发态是 Vite 的 http 地址，打包后是 dist 里的
 * file:// 资源（Electron 允许从 file:// 页面创建 module worker）；
 * cMap / 标准字体 / wasm 走相对路径，开发态由 vite.config.ts 的中间件提供，
 * 构建时复制到 dist/pdfjs。
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(workerUrl, import.meta.url).href;

const ASSET_BASE = new URL(
  import.meta.env.DEV ? '/pdfjs-assets/' : 'pdfjs/',
  document.baseURI,
).href;

export const PDFJS_ASSETS = {
  cMapUrl: `${ASSET_BASE}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
  wasmUrl: `${ASSET_BASE}wasm/`,
  iccUrl: `${ASSET_BASE}iccs/`,
} as const;

export { pdfjs };
