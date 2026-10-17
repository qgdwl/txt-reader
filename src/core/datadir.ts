/**
 * 启动时挑一个「真的能写」的数据目录。
 *
 * 背景：某些环境下 %APPDATA% 不可写（受限沙箱、只读配置、企业策略），
 * 而 Chromium 在拿不到可写 userData 时会直接崩溃，且崩在主进程 JS 之前就跑不掉了。
 * 所以要在 app ready 之前自己探一遍，探不通就退到安装目录下的 data/（便携模式）。
 */
export interface DirProbeFs {
  mkdirSync(dir: string, options: { recursive: true }): unknown;
  writeFileSync(file: string, data: string): unknown;
  rmSync(file: string, options: { force: true }): unknown;
}

const PROBE_FILE = '.write-probe';

/** 返回第一个可写目录；全都不可写时返回 null。 */
export function pickWritableDir(
  candidates: readonly string[],
  fsImpl: DirProbeFs,
  probeFile: string = PROBE_FILE,
): string | null {
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      fsImpl.mkdirSync(dir, { recursive: true });
      const probe = `${dir}/${probeFile}`;
      fsImpl.writeFileSync(probe, 'ok');
      fsImpl.rmSync(probe, { force: true });
      return dir;
    } catch {
      // 换下一个候选
    }
  }
  return null;
}
