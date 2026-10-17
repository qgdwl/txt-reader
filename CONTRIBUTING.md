# 参与维护

作者不再主动维护这个项目，但欢迎：

- **fork 后继续维护**（MIT 许可允许）；
- 或联系作者，把你的 GitHub 账号加为仓库协作者（Settings → Collaborators）；
- 或者直接提交 Issue / Pull Request。

## 本地开发

需要 Node.js 22.13+ 与 pnpm 9+：

```bash
pnpm install
pnpm test        # 单元测试
pnpm typecheck   # 两个 tsconfig
pnpm build       # 主进程 + 渲染层
pnpm start       # 构建后启动
```

更完整的说明（数据目录、冒烟测试、打包、常见坑）见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 提交 PR

1. 从 `main` 开一个分支；
2. 改代码时**同时新增/更新对应测试**，并保证 `pnpm test`、`pnpm typecheck` 全绿；
3. 不要提交 `node_modules/`、`release/`、`data/`、书籍文件、绿色版 zip（`.gitignore` 已排除）；
4. 在 PR 里写清楚：改了什么、为什么、怎么验证的。

## 发布新版本

1. 更新 `package.json` 的 `version`；
2. 跑完整验证：`pnpm test`、`pnpm typecheck`，再 `node scripts/package.mjs --zip`；
3. 在 GitHub **Releases** 新建 tag（如 `v0.1.1`），把 `TXT阅读器-绿色版.zip` 作为 Release 附件上传；
   **不要把 zip 提交进仓库**（115MB，超过 GitHub 单文件 100MB 限制，也会让仓库变得巨大）；
4. 打包产物里的 `app/LICENSE`、`app/LICENSES.chromium.html` 以及 `dist/pdfjs/` 下的
   pdf.js 许可证要保留，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可证

贡献的代码按 [MIT](LICENSE) 许可合并。
