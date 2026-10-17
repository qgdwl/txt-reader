import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const tscScript = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
export const viteScript = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

export function electronBinary() {
  const binary = require('electron');
  if (typeof binary !== 'string') {
    throw new Error('Electron 未安装完成，请先运行 pnpm install');
  }
  return binary;
}

/**
 * 启动 Electron 用的环境变量。
 * 某些终端/工具链会设置 ELECTRON_RUN_AS_NODE=1，那会让 Electron 退化成纯 Node，
 * 连 app 模块都不存在，必须在子进程里去掉。
 */
/**
 * Windows 11 25H2（Build 26200+）的 Electron GPU 沙箱会崩溃，需要 --no-sandbox。
 * 判定逻辑与 src/core/platform.ts 保持一致（那边有单元测试）。
 */
export function sandboxArgs() {
  if (process.platform !== 'win32') return [];
  const build = Number(os.release().split('.')[2] ?? 0);
  if (!Number.isFinite(build) || build < 26200) return [];
  if (process.env.READER_NO_SANDBOX === '0') return [];
  return ['--no-sandbox'];
}

/**
 * 开发/测试用的数据目录。Chromium 在拿不到可写 userData 时会在主进程 JS 之前崩溃，
 * 所以开发态也显式指定，不依赖 %APPDATA% 是否可写。
 */
export function dataDir() {
  return process.env.READER_DATA_DIR || path.join(projectRoot, '.dev-data');
}

/** 组装启动 Electron 的参数：应用路径 + 额外参数 + 必要开关 + 显式数据目录。 */
export function appArgs(...extra) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  return ['.', ...extra, ...sandboxArgs(), `--user-data-dir=${dir}`];
}

export function electronEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** 启动子进程；stdio 直接继承，避免沙箱下管道被拒。 */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd: projectRoot, ...options });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} 退出：${signal ?? code}`));
    });
  });
}

export function runNode(script, args = [], options = {}) {
  return run(process.execPath, [script, ...args], options);
}

export function buildMain() {
  return runNode(tscScript, ['-p', 'tsconfig.electron.json']);
}

export function buildWeb() {
  // 某些 Windows 环境下用户临时目录会被安全软件短暂锁住，esbuild 写完临时文件后删不掉，
  // 构建会以 “Access is denied” 失败。把子进程的临时目录指到仓库内（gitignore 里）。
  const tmp = path.join(projectRoot, '.test-tmp', 'build-tmp');
  fs.mkdirSync(tmp, { recursive: true });
  return runNode(viteScript, ['build'], {
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp },
  });
}

function probe(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(800, () => done(false));
  });
}

export async function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待端口 ${port} 超时`);
}
