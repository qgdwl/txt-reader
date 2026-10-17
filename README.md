# TXT 阅读器

一个本地优先的桌面电子书阅读器（TXT / EPUB / PDF），Electron + React + TypeScript。

> **状态：不再维护（Unmaintained）。** 代码按现状提供，欢迎 fork；不保证 issue / PR 响应。

## 这一版做了什么

MVP 的目标只有一条：**一本书从导入到读完不掉链子，下次打开还在原地。**
v11.2 起支持 PDF：原文件保存、按页渲染成一页一屏，进度与书签按页码记。

| 功能 | 说明 |
| --- | --- |
| 导入 | 系统文件对话框（可多选）或直接把文件拖进窗口 |
| 格式 | **EPUB**（ZIP + OPF + nav/ncx，解析成纯文本与章节）、TXT、**PDF**（原文件保存，按页渲染） |
| 编码识别 | BOM / UTF-8 / UTF-16LE / UTF-16BE / GBK（按 GB18030 解码）自动判断；PDF 不涉及 |
| 书名作者 | 从文件名猜（`《书名》作者`、`书名(作者)`、`书名 by 作者`），文件名没有作者时再看正文前几行的「作者：」 |
| 章节识别 | 识别 `第X章/回/卷/节/篇`、`序章/楔子/番外`、`Chapter N`；没有标题时按 6000 字自动分块 |
| 阅读方式 | TXT/EPUB：**竖向分页**，一页一屏、整屏上下翻，翻页位置吸附到行边界，不会切到半行字；PDF：**一页一屏**，整页按比例放进窗口 |
| PDF 阅读 | 只渲染当前页与前后各一页；方向键/空格/滚轮/点击上下半屏翻页；进度与书签按页码记 |
| 阅读界面 | 字号、行距、版心宽度、三种主题（纸白/羊皮纸/夜间）、宋体/黑体/等线、字重（常规/中等/加粗） |
| 目录 | 侧边栏章节列表，点击跳转（PDF 暂不支持目录/搜索） |
| 进度记忆 | TXT/EPUB 记录**全书字符偏移**；PDF 记录**页码**，关掉再开还停在原页 |
| 书签 | 固定在侧栏**顶部**，带章节名与摘要，点击跳转；PDF 书签记页码 |
| 书内搜索 | `Ctrl+F` 边输边搜，结果带上下文，点击跳转并高亮命中（PDF 暂不支持） |
| 阅读统计 | 今日/累计/日均 + 最近 7 天柱状图，可清空 |
| 老板模式 | 默认按 `E` 一键缩成半透明小窗、置顶、可拖动，再按还原；**热键可在设置里改**（单键只在窗口内生效，组合键全局生效） |
| 快捷键 | `←` `→` `↑` `↓` / `空格` / `PgUp` `PgDn` 翻页，`Esc` 返回书架（PDF 同样适用） |
| 书架 | 封面字、作者、编码/格式、字数或页数、进度条、继续阅读、删除 |

**明确不做**：MOBI/AZW3、账号与云同步、划线批注；PDF 的文字搜索/目录/选中复制留到后续版本。

## 文档

产品方向与功能规划见 [docs/DESIGN.md](docs/DESIGN.md)；可交互的界面演示见 [docs/demo/index.html](docs/demo/index.html)（浏览器直接打开）；开发、测试与打包说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 开发

需要 Node.js 22.13+ 与 pnpm 9+。

```bash
pnpm install
pnpm dev      # 开发模式：Vite 热更新 + Electron 窗口
pnpm start    # 生产模式：先构建再启动
pnpm test     # 单元测试（Vitest）
pnpm smoke    # 构建后启动应用自检，确认界面能渲染
pnpm typecheck
pnpm package  # 打包成可双击运行的 exe
```

## 打包与运行 exe

```bash
pnpm package              # 只打包到 release/
node scripts/package.mjs --zip   # 打包并生成可发给别人的压缩包
```

产物在 `release/TXTReader-win32-x64/`，**双击 `TXT阅读器.exe`** 即可运行。
加上 `--zip` 还会在仓库根目录生成 `TXT阅读器-绿色版.zip`（约 115MB，其中 pdf.js 约 6MB）：
**压缩包里不含 `data/`**，别人解压后是干净的书库；对方双击包内的「创建桌面快捷方式.cmd」即可在桌面生成图标。

⚠️ 打包会重建整个 `release/TXTReader-win32-x64/`，但 `data/` 会**自动暂存并放回**：
打包前先移到 `release/_data-hold`，打包完成后自动恢复；如果阅读器还开着（目录被占用），
打包会直接中止并提示先退出，不会再删掉书和进度。

目录结构：

```
TXTReader-win32-x64/
├─ TXT阅读器.exe          ← 双击这个（4 KB 启动器）
├─ 创建桌面快捷方式.cmd    ← 在桌面生成图标（压缩包里给别人用的）
├─ 启动阅读器.cmd          ← 备用入口，效果相同
├─ 使用说明.txt
├─ app/                   ← 真正的 Electron 程序，别单独双击
└─ data/                  ← 书籍与进度，首次启动生成
```

`TXT阅读器.exe` 不是 Electron 本体，而是一个极小的 .NET 启动器（`scripts/launcher/ReaderLauncher.cs`，用系统自带 `csc.exe` 编译）：因为本机裸双击 Electron exe 会崩，且崩溃早于 JS 无法自救，必须由外层把 `--no-sandbox --user-data-dir` 带上。

如果弹出「Windows 已保护你的电脑」：这是 SmartScreen 对**未签名程序**的提示，点「更多信息」→「仍要运行」。
发给别人时，提醒对方**先右键压缩包 → 属性 → 解除锁定 → 再解压**，通常就不会再被拦。

整个 `release/TXTReader-win32-x64/` 目录是绿色版，可以整体拷到别处或 U 盘。

## 目录结构

```
electron/          Electron 主进程与 preload（IPC 边界）
src/core/          纯逻辑：编码、章节、书名、进度、偏好（全部有单元测试）
src/main/          主进程侧：书库存储（library.json）与书籍文件读写
src/shared/        主进程与渲染层共享的类型和 API 契约
src/renderer/      React 界面：书架、阅读器、排版面板
tests/             Vitest 测试
scripts/           构建与启动脚本（不依赖 PATH 里的 node/npm）；make-icon.py 生成图标
assets/            icon.ico / icon.png（由 image/icon-source.png 圆角转换而来）
```

## 数据存放

打包版是绿色模式，数据在 exe 同级的 `data/` 下：

- `data/library/library.json`：书籍列表、阅读进度、排版偏好
- `data/library/books/<id>.txt`：TXT/EPUB 导入时的正文副本（原文件删了也不影响阅读）
- `data/library/books/<id>.pdf`：PDF 原文件副本（按页渲染，不抽文字）

开发态（`pnpm start` / `pnpm dev` / `pnpm smoke`）把数据放在仓库内的 `.dev-data/`，不依赖 `%APPDATA%` 是否可写。可用环境变量 `READER_DATA_DIR` 指定到别处。

数据目录如果不可写（受限环境），启动时会自动退到 exe 同级 `data/`，仍然不可写则给出警告。

## 已知限制

1. **支持 EPUB、TXT 与 PDF**；MOBI/AZW3 未实现（MOBI 建议先用 Calibre 转 EPUB）。
2. **PDF 是「一页一屏」的按页显示**：不支持选中复制、搜索、目录，加密/需要密码的 PDF 打不开；超大页面会按像素上限降低清晰度。这些是 v11.2 的刻意取舍，后续版本再加。
3. **TXT 的章节识别是启发式的**：带目录页的文件可能把目录行也当成章节；EPUB 则直接使用原书目录。
4. **EPUB 只取正文文字与插图**：内置样式、脚注暂不还原。早期版本（v11.0 及更早）导入的书没有图片索引，需要重新导入；v11.1 之后导入但图片索引错位的书，打开时会自动修复。导入时被跳过（缺失/超大）的图片无法补回，其位置仍显示「[图片]」。
5. **公式按纯文本提取**：源码排版造成的换行会被折叠，公式不会再一次一行（需要重新导入才生效）；但上下标、分式等数学排版不会还原成原书样式，要完全还原需要把 MathML/SVG 当图渲染。
6. **Windows 11 25H2（Build 26200+）必须带启动参数**：该系统版本上 Electron 的 GPU 沙箱会以 `-2147483645` 崩溃，[上游同类 issue](https://github.com/iOfficeAI/AionUi/issues/2912)。崩溃发生在主进程 JS 执行之前，程序内部无法自救（`appendSwitch` / `app.relaunch` 都实测无效），所以只能由外层启动方带参数：

   - 打包产物的 `TXT阅读器.exe` 就是干这个的：极小 .NET 启动器，补齐 `--no-sandbox --user-data-dir=<data>` 后拉起 `app/TXTReader.exe`；
   - `app/TXTReader.exe` 单独双击会闪退，这是预期行为；
   - 不用快捷方式（`.lnk`）作为入口：它经资源管理器启动，容易触发 SmartScreen 对未签名程序的拦截；
   - `pnpm dev` / `pnpm start` 会按系统版本自动补 `--no-sandbox`；
   - 想确认这个参数是否真的必要：用「任务计划程序」直接启动 `app\TXTReader.exe`（不带参数），进程会以 `-2147483645` 退出。
7. 从仓库直接 `electron .` 启动可能因为缺少上述参数而崩溃，请用 `pnpm start`。
8. **正文保留原始换行**：如果你手上的 TXT 是按 40 字硬换行的，每行会比版心窄，右侧看起来参差。自动重排（合并硬换行）属于下一版内容，目前可以用「版心」滑块把宽度调窄来缓解。
9. 阅读进度记录的是「全书字符偏移」（PDF 是页码），改字号、行距、版心后会自动重新分页并回到同一句附近。
10. **PDF 依赖 pdf.js 的 legacy 构建**：Electron 33 是 Chromium 130，标准构建缺少 `Uint8Array.prototype.toHex` 会打不开任何 PDF；换成 legacy 后自带 polyfill。升级 Electron 到更新版本前不要改回标准构建。

## 测试策略

纯逻辑（编码、章节、书名、进度、偏好、平台判断、数据目录探测、锚点定位、分页、书签、HTML 文本提取与空白折叠、图片尺寸、插图偏移对齐、乱码清理、PDF 页码与适配缩放、ZIP/XML/EPUB 解析、ZIP 写入）与文件层（书库存储、书签、导入读取，含 PDF 导入/删除、旧书图片索引自愈）都有单元测试，共 24 个测试文件 344 个用例。

UI 不写细粒度测试，用一个**带逐页断言的冒烟测试**代替：构建后真实启动 Electron，打开书连续翻页，逐页断言「可见行数 > 0（不是空白页）」「没有被切掉一半的行」「页码只增不减」。用法：

```bash
READER_SCREENSHOT=out.png READER_SCREENSHOT_OPEN=1 READER_SMOKE_ASSERT=30 node scripts/smoke.mjs
```

PDF 另有一套「一页一屏」断言：先用 `scripts/make-test-pdf.mjs` 生成一本 8 页的真实样本（含中文、表格、代码与位图），再让阅读器导入并连续翻页，断言页数正确、每页画布像素非空、页码递增、书签跳页、老板模式仍能渲染、退出重进恢复页码：

```bash
node_modules/electron/dist/electron.exe scripts/make-test-pdf.mjs --no-sandbox
echo "先删掉 .smoke-data/pdf-data，再跑："
READER_SMOKE_DATA_DIR=.smoke-data/pdf-data \
READER_SMOKE_PDF=1 \
READER_SMOKE_PDF_FILE=.smoke-data/pdf-src/PDF渲染测试.pdf \
READER_SCREENSHOT=pdf.png node scripts/smoke.mjs
```

拿几本真实书各翻 30 页、老板模式、翻页中缩放窗口、改字号/版心都要跑；只要有一项不过，冒烟测试就以非零码退出。

打包产物的双击链路额外用「任务计划程序」验证（该进程不继承开发环境的限制，等价于用户双击）：确认 `TXT阅读器.exe` 能把应用拉起来并渲染界面。

## 许可证

源代码以 [MIT](LICENSE) 发布。第三方组件（Electron、React、pdf.js 等）的许可证与随附资源声明见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [licenses/](licenses/)。

本仓库不包含任何书籍正文；导入的书籍只保存在本机数据目录。

