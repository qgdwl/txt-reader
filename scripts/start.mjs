import { spawn } from 'node:child_process';
import process from 'node:process';
import { appArgs, buildMain, buildWeb, electronBinary, electronEnv, projectRoot } from './lib.mjs';

const extraArgs = process.argv.slice(2);

try {
  await buildMain();
  await buildWeb();
} catch (error) {
  console.error('构建失败：', error.message);
  process.exit(1);
}

const electron = spawn(electronBinary(), appArgs(...extraArgs), {
  stdio: 'inherit',
  cwd: projectRoot,
  env: electronEnv(),
});

electron.on('exit', (code) => process.exit(code ?? 0));
