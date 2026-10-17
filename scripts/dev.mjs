import { spawn } from 'node:child_process';
import process from 'node:process';
import {
  appArgs,
  buildMain,
  electronBinary,
  electronEnv,
  projectRoot,
  viteScript,
  waitForPort,
} from './lib.mjs';

const PORT = 5173;

try {
  await buildMain();
} catch (error) {
  console.error('主进程编译失败：', error.message);
  process.exit(1);
}

const vite = spawn(process.execPath, [viteScript, '--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
  cwd: projectRoot,
});

const stop = () => {
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  await waitForPort(PORT);
} catch (error) {
  console.error(error.message);
  vite.kill();
  process.exit(1);
}

const electron = spawn(electronBinary(), appArgs(), {
  stdio: 'inherit',
  cwd: projectRoot,
  env: electronEnv({ VITE_DEV_SERVER_URL: `http://127.0.0.1:${PORT}` }),
});

electron.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
