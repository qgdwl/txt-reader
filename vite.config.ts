import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * pdf.js 运行时按需抓取的资源：cMap、标准字体、wasm 解码器、ICC 配置。
 * 它们不在 JS 包里，必须按原样放到 dist 下，否则中文 CID 字体、扫描件的
 * JPEG2000 / JBIG2 图片会解不出来。
 */
const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;
const PDFJS_PREFIX = '/pdfjs-assets';

function mimeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'text/javascript';
  if (ext === '.wasm') return 'application/wasm';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
}

/** 开发态从 node_modules 直接提供这些文件；构建时复制到 dist/pdfjs。 */
function pdfjsAssets(): Plugin {
  let source = path.resolve(process.cwd(), 'node_modules', 'pdfjs-dist');
  let outDir = path.resolve(process.cwd(), 'dist');

  return {
    name: 'reader-pdfjs-assets',
    configResolved(config) {
      const root = path.resolve(config.root);
      // vite.config.ts 的 root 是 src/renderer，往上两级是项目根目录
      source = path.resolve(root, '..', '..', 'node_modules', 'pdfjs-dist');
      outDir = path.resolve(root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith(`${PDFJS_PREFIX}/`)) {
          next();
          return;
        }
        const relative = decodeURIComponent(url.slice(PDFJS_PREFIX.length + 1));
        const full = path.resolve(source, relative);
        // 只允许读 pdfjs-dist 目录内的文件，挡住 ../ 穿越
        if (!full.startsWith(source + path.sep)) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }
        fs.stat(full, (error, stat) => {
          if (error || !stat.isFile()) {
            next();
            return;
          }
          res.setHeader('Content-Type', mimeOf(full));
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(full).pipe(res);
        });
      });
    },
    writeBundle() {
      for (const dir of PDFJS_DIRS) {
        const from = path.join(source, dir);
        if (!fs.existsSync(from)) continue;
        fs.cpSync(from, path.join(outDir, 'pdfjs', dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), pdfjsAssets()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    target: 'chrome120',
    // pdf.js 本身就有几 MB，单独一条体积警告没有意义
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
