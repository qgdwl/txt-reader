# 开发说明

## 目录结构

```
electron/          Electron 主进程与 preload（IPC 边界）
src/core/          纯逻辑：编码、章节、书名、进度、偏好、分页、书签、图片偏移对齐…
src/main/          主进程侧：书库存储、导入、EPUB/PDF 文件处理
src/shared/        主进程与渲染层共享的类型和 API 契约
src/renderer/      React 界面：书架、TXT/EPUB 阅读器、PDF 阅读器
tests/             Vitest 单元测试
scripts/           构建、启动、冒烟、打包脚本（不依赖 PATH 里的 node/npm）
assets/            应用图标
docs/              产品设计与可交互演示
```

## 环境要求

- Node.js **22.13+**（`pdfjs-dist` 6 的 engines 要求）
- pnpm 9+
- Windows 10/11 用于打包；开发本身不依赖 Windows（打包脚本包含 Windows 启动器/图标处理）

## 安装与运行

```bash
pnpm install
pnpm dev        # 开发模式：Vite + Electron
pnpm start      # 构建后启动
pnpm test       # Vitest
pnpm typecheck  # 两个 tsconfig 都检查
pnpm smoke      # 构建后启动应用自检
pnpm package    # 打包到 release/
```

打包并生成绿色版压缩包：

```bash
node scripts/package.mjs --zip
```

## 测试

纯逻辑与文件层都有单元测试，共 24 个测试文件、344 个用例：

```bash
pnpm test
```

UI 用「真实启动 Electron + 逐页断言」的冒烟测试代替：

```bash
# 连续翻页，断言不空白、不切半行、页码连续
READER_SCREENSHOT="$PWD/.smoke-data/out.png" \
READER_SCREENSHOT_OPEN=1 READER_SMOKE_ASSERT=30 \
node scripts/smoke.mjs
```

冒烟需要一个数据目录（里面是已导入的书）。可以用 `READER_DATA_DIR` 指向开发数据，
或用 `READER_SMOKE_DATA_DIR` 单独指定。其它开关：

| 环境变量 | 作用 |
| --- | --- |
| `READER_SMOKE_ASSERT_BOSS=1` | 老板模式里跑逐页断言 |
| `READER_SMOKE_ASSERT_RESIZE=1` | 翻页中途缩放窗口 |
| `READER_SMOKE_BOOKMARK_JUMP=1` | 同章书签跳转 |
| `READER_SMOKE_IMAGES=1` | 翻到图文页并断言图片真的加载 |
| `READER_SMOKE_SEARCH=关键词` | 打开搜索并输入关键词 |
| `READER_SMOKE_PDF=1` + `READER_SMOKE_PDF_FILE=...` | PDF 逐页断言 |
| `READER_SMOKE_PDF_STEPS=8` | PDF 连翻页数（默认 4） |

PDF 冒烟需要一本真实 PDF。仓库提供了生成脚本：

```bash
node_modules/electron/dist/electron.exe scripts/make-test-pdf.mjs --no-sandbox
rm -rf .smoke-data/pdf-data
READER_SMOKE_DATA_DIR="$PWD/.smoke-data/pdf-data" \
READER_SMOKE_PDF=1 \
READER_SMOKE_PDF_FILE="$PWD/.smoke-data/pdf-src/PDF渲染测试.pdf" \
READER_SCREENSHOT="$PWD/.smoke-data/pdf.png" \
node scripts/smoke.mjs
```

## 数据目录

- 开发态：`.dev-data/`（可用 `READER_DATA_DIR` 覆盖）
- 打包版：`release/TXTReader-win32-x64/data/`
- `library.json`：书籍列表、进度、书签、偏好
- `books/<id>.txt`：TXT/EPUB 的正文副本
- `books/<id>.pdf`：PDF 原文件
- `books/<id>.media/`：EPUB 插图（按内容哈希命名）

## 打包

`scripts/package.mjs` 会：

1. 编译主进程、构建渲染层；
2. 把 `data/` 暂存到 `release/_data-hold`；
3. 重建 `release/TXTReader-win32-x64/`；
4. 编译双击启动器（.NET）、写 `使用说明.txt` 等；
5. 自动把 `data/` 放回；
6. 可选 `--zip` 生成绿色版压缩包（不含 `data/`）。

**打包前先完全退出阅读器**：如果 `data/` 被占用，脚本会中止并提示，不会先删后补。

## 常见问题

1. Windows 11 25H2 上 Electron 的 GPU 沙箱会崩溃（进程在 JS 执行前退出）。打包产物由
   `TXT阅读器.exe`（.NET 启动器）带 `--no-sandbox` 启动；开发时 `pnpm start` / `pnpm dev`
   会自动补参数。直接双击 `app/TXTReader.exe` 闪退是预期行为。
2. 启动 Electron 前要确保 `ELECTRON_RUN_AS_NODE` 未设置，否则 `app` 是 undefined。
3. `pdf.js` 使用 **legacy 构建**：Electron 33 的 Chromium 130 缺少
   `Uint8Array.prototype.toHex`（Chrome 133 才有），标准构建会打不开任何 PDF。
4. pdf.js 的 `cmaps / standard_fonts / wasm / iccs` 必须随 `dist/pdfjs/` 分发；
   开发态由 Vite 中间件提供，构建时由 `vite.config.ts` 的插件复制。
5. Windows 上 esbuild 的临时文件可能被安全软件锁住，导致 `vite build` 报
   `Access is denied`。`scripts/lib.mjs` 已把构建子进程的 `TEMP/TMP/TMPDIR`
   指向 `.test-tmp/build-tmp`；手动跑 `vite build` 时也可以这样设。
6. `READER_SMOKE_ASSERT` 需要配合 `READER_SCREENSHOT_OPEN=1`，否则只会停在书架。
7. 已导入的旧书如果插图索引与正文错位，打开时会自动按占位符重排；数量不一致
   （导入时跳过了缺失/超大图）时不会乱贴图。v11.0 及更早导入的书没有图片索引，需要重新导入。
8. 公式/源码换行的折叠只在导入时生效；已导入的书要重新导入一次。

## 已知限制

- PDF 只做「一页一屏」显示：不支持选中复制、搜索、目录；加密 PDF 打不开。
- EPUB 只取正文文字与插图：CSS 样式、脚注不还原；数学公式按纯文本显示，不还原数学排版。
- 不支持 MOBI / AZW3。
- 书内搜索只支持 TXT / EPUB，不支持 PDF。
