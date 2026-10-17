import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const BASE = path.join(process.cwd(), '.test-tmp');

/** 在仓库内建临时目录，避免写系统临时目录被沙箱拦截。 */
export async function makeTempDir(prefix: string): Promise<string> {
  await mkdir(BASE, { recursive: true });
  return mkdtemp(path.join(BASE, `${prefix}-`));
}
