import { describe, expect, it } from 'vitest';
import { pickWritableDir } from '../src/core/datadir';
import type { DirProbeFs } from '../src/core/datadir';

interface FakeOptions {
  /** 这些目录写入会抛错。 */
  denied?: string[];
}

function fakeFs(options: FakeOptions = {}): DirProbeFs & { written: string[]; removed: string[] } {
  const denied = new Set(options.denied ?? []);
  const written: string[] = [];
  const removed: string[] = [];
  return {
    written,
    removed,
    mkdirSync(dir) {
      if (denied.has(dir)) throw new Error(`EPERM: ${dir}`);
      return undefined;
    },
    writeFileSync(file) {
      written.push(file);
      return undefined;
    },
    rmSync(file) {
      removed.push(file);
      return undefined;
    },
  };
}

describe('pickWritableDir', () => {
  it('第一个候选可写时直接用它', () => {
    const fs = fakeFs();
    expect(pickWritableDir(['A', 'B'], fs)).toBe('A');
    expect(fs.written).toEqual(['A/.write-probe']);
    expect(fs.removed).toEqual(['A/.write-probe']);
  });

  it('第一个不可写时退到下一个', () => {
    const fs = fakeFs({ denied: ['A'] });
    expect(pickWritableDir(['A', 'B'], fs)).toBe('B');
  });

  it('全部不可写时返回 null', () => {
    const fs = fakeFs({ denied: ['A', 'B'] });
    expect(pickWritableDir(['A', 'B'], fs)).toBeNull();
  });

  it('写入失败也算不可用（不能只看能不能建目录）', () => {
    const fs = fakeFs();
    fs.writeFileSync = () => {
      throw new Error('EACCES');
    };
    expect(pickWritableDir(['A', 'B'], fs)).toBeNull();
  });

  it('跳过空路径', () => {
    const fs = fakeFs();
    expect(pickWritableDir(['', 'B'], fs)).toBe('B');
  });

  it('空候选列表返回 null', () => {
    expect(pickWritableDir([], fakeFs())).toBeNull();
  });

  it('探测后会删掉探针文件', () => {
    const fs = fakeFs();
    pickWritableDir(['A'], fs);
    expect(fs.removed).toEqual(['A/.write-probe']);
  });
});
