/**
 * Windows 11 25H2（Build 26200 起）上 Electron 的 GPU 沙箱会直接崩溃
 * （GPU process exited unexpectedly, exit_code=-2147483645）。
 * 这是一个已知的环境兼容问题，社区通用的绕过方式是关闭 Chromium 沙箱。
 *
 * 本应用只加载本地打包文件、不渲染任何远程内容，因此这里的取舍可以接受。
 */
export const SANDBOX_BROKEN_BUILD = 26200;

export function windowsBuildNumber(release: string): number {
  const parts = release.split('.');
  const build = Number(parts[2]);
  return Number.isFinite(build) ? build : 0;
}

/** 是否需要为本机禁用沙箱才能启动。 */
export function shouldDisableSandbox(platform: string, release: string): boolean {
  if (platform !== 'win32') return false;
  return windowsBuildNumber(release) >= SANDBOX_BROKEN_BUILD;
}

/** 允许用环境变量强制开关，便于出问题时排查：READER_NO_SANDBOX=0/1。 */
export function resolveNoSandbox(
  platform: string,
  release: string,
  override: string | undefined,
): boolean {
  if (override === '1') return true;
  if (override === '0') return false;
  return shouldDisableSandbox(platform, release);
}
