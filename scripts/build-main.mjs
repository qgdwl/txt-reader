import process from 'node:process';
import { buildMain } from './lib.mjs';

try {
  await buildMain();
} catch (error) {
  console.error('主进程编译失败：', error.message);
  process.exit(1);
}
