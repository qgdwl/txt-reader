import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { appArgs, buildMain, buildWeb, electronBinary, electronEnv, projectRoot } from './lib.mjs';

const dataDir = process.env.READER_SMOKE_DATA_DIR
  ? path.resolve(process.env.READER_SMOKE_DATA_DIR)
  : path.join(projectRoot, '.smoke-data', 'userdata');

try {
  await buildMain();
  await buildWeb();
} catch (error) {
  console.error('构建失败：', error.message);
  process.exit(1);
}

const child = spawn(electronBinary(), appArgs('--smoke-test'), {
  stdio: 'inherit',
  cwd: projectRoot,
  env: electronEnv({ READER_DATA_DIR: dataDir }),
});

child.on('exit', (code) => {
  console.log(code === 0 ? '冒烟测试通过' : `冒烟测试失败（退出码 ${code}）`);
  process.exit(code ?? 1);
});
