# 第三方组件与许可证

本项目的源代码以 [MIT](LICENSE) 许可发布。运行时和构建过程使用以下第三方组件，
它们各自保留原许可证：

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) | 桌面运行时 | MIT；其内置 Chromium 使用 BSD 风格及一组第三方许可证 |
| [React](https://react.dev/) / React DOM | 界面 | MIT |
| [pdf.js / pdfjs-dist](https://mozilla.github.io/pdf.js/) | PDF 按页渲染 | Apache-2.0 |
| [Vite](https://vitejs.dev/) | 渲染层构建 | MIT |
| [TypeScript](https://www.typescriptlang.org/) | 语言/构建 | Apache-2.0 |
| [Vitest](https://vitest.dev/) | 单元测试 | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | React 构建插件 | MIT |
| [@electron/packager](https://github.com/electron/packager) | 打包 | BSD-2-Clause |

## pdf.js 及其随附资源

本项目在构建时会把 pdf.js 的 `cmaps`、`standard_fonts`、`wasm`、`iccs` 复制到
`dist/pdfjs/`，随应用一起分发。原始许可证文本保存在 [`licenses/pdfjs/`](licenses/pdfjs/)：

- `LICENSE`：pdf.js 本体（Apache-2.0）
- `LICENSE_FOXIT`、`LICENSE_LIBERATION`：标准字体
- `LICENSE_JBIG2`、`LICENSE_OPENJPEG`、`LICENSE_QCMS`、`LICENSE_PDFJS_*`：wasm 解码器
- `LICENSE_cmaps`、`LICENSE_iccs`：CMap 与 ICC 配置

## 关于打包产物

如果分发打包后的 `TXTReader-win32-x64`（含 Electron 运行时）：

- `app/LICENSE` 与 `app/LICENSES.chromium.html` 是 Electron / Chromium 的许可证，请保留；
- `app/resources/app.asar` 内的 `dist/pdfjs/` 保留了上述 pdf.js 各组件许可证；
- 不要删除这些文件。

## 书籍内容

本仓库**不包含任何书籍正文**。用户导入的书籍、阅读进度、书签只保存在本机数据目录，
不会上传，也不应提交到仓库（`.gitignore` 已排除 `book/`、`release/`、`data/` 等路径）。
