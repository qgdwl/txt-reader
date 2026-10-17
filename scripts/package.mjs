import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildMain, buildWeb, projectRoot } from './lib.mjs';

const require = createRequire(import.meta.url);
const packagerModule = require('@electron/packager');
const packager = typeof packagerModule === 'function' ? packagerModule : packagerModule.packager;

if (!packager) {
  console.error('未找到 @electron/packager，请先运行 pnpm install');
  process.exit(1);
}

// 复用工作区内的 Electron 缓存，避免再次下载运行时
process.env.ELECTRON_CACHE ||= path.join(projectRoot, '.electron-cache');

const APP_NAME = 'TXTReader';
const LAUNCHER_NAME = 'TXT阅读器.exe';
const RELEASE_DIR = path.join(projectRoot, 'release');
const OUTPUT_DIR = path.join(RELEASE_DIR, 'TXTReader-win32-x64');
const STAGE_DIR = path.join(RELEASE_DIR, '_stage');
const DATA_DIR = path.join(OUTPUT_DIR, 'data');
const DATA_HOLD = path.join(RELEASE_DIR, '_data-hold');

/**
 * Windows 11 25H2（Build 26200+）上 Electron 的 GPU 沙箱会崩（exit_code=-2147483645），
 * 崩溃发生在主进程 JS 执行之前，程序内部无法自救，只能由启动方带 --no-sandbox。
 */
const NEEDS_NO_SANDBOX =
  process.platform === 'win32' && Number(os.release().split('.')[2] ?? 0) >= 26200;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`))));
  });
}

function findCsc() {
  const roots = [
    `${process.env.SystemRoot}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
    `${process.env.SystemRoot}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
  ];
  return roots.find((candidate) => candidate && require('node:fs').existsSync(candidate)) ?? null;
}

/** 编译双击入口：一个极小的 .NET 程序，负责带上 --no-sandbox 再拉起 Electron。 */
async function buildLauncher(targetDir) {
  const csc = findCsc();
  if (!csc) {
    console.warn('未找到 csc.exe（.NET Framework），跳过双击入口，请用启动阅读器.cmd');
    return false;
  }
  const source = path.join(projectRoot, 'scripts', 'launcher', 'ReaderLauncher.cs');
  const output = path.join(targetDir, LAUNCHER_NAME);
  const icon = path.join(projectRoot, 'assets', 'icon.ico');
  const iconArg = require('node:fs').existsSync(icon) ? [`/win32icon:${icon}`] : [];
  await run(csc, ['/nologo', '/target:winexe', '/codepage:65001', '/optimize+', ...iconArg, `/out:${output}`, source]);
  console.log(`LAUNCHER ${output}`);
  return true;
}

async function writeLaunchers(outputDir) {
  if (process.platform !== 'win32') return;

  const args = NEEDS_NO_SANDBOX ? '--no-sandbox' : '';
  const cmdPath = path.join(outputDir, '启动阅读器.cmd');
  await fs.writeFile(
    cmdPath,
    `@echo off\r\nstart "" "%~dp0app\\${APP_NAME}.exe" ${args} --user-data-dir="%~dp0data" %*\r\n`,
    'utf8',
  );

  // 给拿到压缩包的人用：双击就在自己的桌面生成一个快捷方式（指向解压后的位置）
  const shortcutCmd = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'set "BASE=%~dp0"',
    'set "APP=%BASE%TXT阅读器.exe"',
    'if not exist "%APP%" (',
    '  echo 找不到 TXT阅读器.exe，请确认整个文件夹已完整解压。',
    '  pause',
    '  exit /b 1',
    ')',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath(\'Desktop\')) \'TXT阅读器.lnk\')); $s.TargetPath = \'%APP%\'; $s.WorkingDirectory = \'%BASE%\'; $s.IconLocation = \'%APP%,0\'; $s.Save()"',
    'if errorlevel 1 (',
    '  echo 创建桌面快捷方式失败，请手动把 TXT阅读器.exe 发送到桌面。',
    '  pause',
    '  exit /b 1',
    ')',
    'echo 已在桌面创建「TXT阅读器」图标。',
    'ping -n 3 127.0.0.1 >nul',
    '',
  ].join('\r\n');
  await fs.writeFile(path.join(outputDir, '创建桌面快捷方式.cmd'), shortcutCmd, 'utf8');

  const readme = [
    'TXT 阅读器（绿色版）',
    '',
    '启动',
    '  1. 双击「TXT阅读器.exe」。',
    '  2. 想放到桌面：双击「创建桌面快捷方式.cmd」，桌面就会出现图标。',
    '',
    '如果弹出「Windows 已保护你的电脑」',
    '  点「更多信息」→「仍要运行」。这是 Windows 对未签名程序的提示，程序本身没问题。',
    '  如果是通过微信/网盘/邮件收到的压缩包：先右键压缩包 →「属性」→ 勾选「解除锁定」→ 再解压，',
    '  这样解压出来的程序通常不会再被拦。',
    '',
    '放在哪里',
    '  解压到桌面、D 盘、U 盘都可以；不要放在 C:\\Program Files，那里存不了书和进度。',
    '  整个文件夹可以整体拷走，换电脑直接能用。',
    '',
    '为什么还有别的文件',
    '  app\\             真正的程序（Electron），单独双击它会闪退，不要动。',
    '  启动阅读器.cmd    备用入口，效果和双击 TXT阅读器.exe 一样。',
    '  data\\            书籍与阅读进度，首次启动自动生成（压缩包里不带，避免带上别人的书）。',
    '',
  ].join('\r\n');
  await fs.writeFile(path.join(outputDir, '使用说明.txt'), readme, 'utf8');
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 打包前把 data/ 暂时移出即将被删除的目录。
 *
 * 之前打包会连用户的书和进度一起删掉，必须手工备份再放回；一旦忘了或
 * 阅读器正好开着，书库就没了。现在自动暂存、打包完自动放回；
 * 阅读器还开着时目录无法移动，直接中止打包并给出提示。
 */
async function holdData() {
  if (await exists(DATA_HOLD)) {
    console.error(`发现上次打包留下的数据：${DATA_HOLD}`);
    console.error(`请先把它移回 ${DATA_DIR} 再打包，避免覆盖书库。`);
    process.exit(1);
  }
  if (!(await exists(DATA_DIR))) return;
  try {
    await fs.rename(DATA_DIR, DATA_HOLD);
  } catch (error) {
    console.error('打包中止：无法移动 data 目录，阅读器可能正在运行。请先完全退出阅读器再打包。');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  console.log(`DATA_HELD ${DATA_HOLD}`);
}

async function restoreData() {
  if (!(await exists(DATA_HOLD))) return;
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  try {
    await fs.rename(DATA_HOLD, DATA_DIR);
  } catch {
    await fs.cp(DATA_HOLD, DATA_DIR, { recursive: true });
    await fs.rm(DATA_HOLD, { recursive: true, force: true });
  }
  console.log(`DATA_RESTORED ${DATA_DIR}`);
}

try {
  await buildMain();
  await buildWeb();
} catch (error) {
  console.error('构建失败：', error.message);
  process.exit(1);
}

async function packageRelease() {
  await holdData();
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
await fs.rm(STAGE_DIR, { recursive: true, force: true });
await fs.mkdir(path.join(OUTPUT_DIR, 'app'), { recursive: true });

const appPaths = await packager({
  dir: projectRoot,
  out: STAGE_DIR,
  overwrite: true,
  asar: true,
  // 运行时不需要 node_modules：渲染层已被 Vite 打包进 dist，主进程只依赖 electron 内置模块。
  // 同时 pnpm 的软链接结构会让 packager 的依赖遍历器报错，直接跳过。
  prune: false,
  platform: 'win32',
  arch: 'x64',
  name: APP_NAME,
  icon: path.join(projectRoot, 'assets', 'icon.ico'),
  appVersion: require(path.join(projectRoot, 'package.json')).version,
  ignore: [
    /^\/node_modules(\/|$)/,
    /^\/(book|docs|image|src|tests|scripts|release|\.git|\.smoke-data|\.dev-data|\.test-tmp|\.npm-cache|\.pnpm-store|\.electron-cache)(\/|$)/,
    /^\/[^/]*\.zip$/,
    /^\/(vite|vitest)\.config\.ts$/,
    /^\/tsconfig(\..*)?\.json$/,
    /^\/(pnpm-lock\.yaml|pnpm-workspace\.yaml|README\.md|AGENTS\.md|\.npmrc|\.gitignore)$/,
  ],
});

// 把打包出来的 Electron 目录整体塞进 app/，顶层只留双击入口与说明
for (const staged of appPaths) {
  for (const entry of await fs.readdir(staged)) {
    await fs.rename(path.join(staged, entry), path.join(OUTPUT_DIR, 'app', entry));
  }
}
await fs.rm(STAGE_DIR, { recursive: true, force: true });

const launcherBuilt = await buildLauncher(OUTPUT_DIR);
await writeLaunchers(OUTPUT_DIR);

console.log(`PACKAGED ${OUTPUT_DIR}`);
console.log(launcherBuilt ? `双击运行 ${path.join(OUTPUT_DIR, LAUNCHER_NAME)}` : `运行 ${path.join(OUTPUT_DIR, '启动阅读器.cmd')}`);

/**
 * --zip：在仓库根目录生成一个可以直接发给别人的压缩包。
 * 不含 data/（避免把自己的书和进度发出去），对方解压即可用。
 */
if (process.argv.includes('--zip')) {
  const zipPath = path.join(projectRoot, 'TXT阅读器-绿色版.zip');
  await fs.rm(zipPath, { force: true });
  try {
    // 自己写 ZIP：中文文件名统一用 UTF-8 + 标志位，避免别人解压出来是乱码
    const { zipDirectory } = require(path.join(projectRoot, 'dist-electron', 'src', 'main', 'zipwrite.js'));
    const result = zipDirectory({
      sourceDir: OUTPUT_DIR,
      prefix: 'TXTReader-win32-x64',
      outputPath: zipPath,
      exclude: ['data'],
    });
    const stat = await fs.stat(zipPath);
    console.log(
      `ZIP ${zipPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB, ${result.entries} 个文件, 不含书籍与进度)`,
    );
  } catch (error) {
    console.error('压缩包生成失败：', error.message);
    process.exitCode = 1;
  }
  }
}

try {
  await packageRelease();
} catch (error) {
  console.error('打包失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await restoreData();
}

