import { describe, expect, it } from 'vitest';
import {
  SANDBOX_BROKEN_BUILD,
  resolveNoSandbox,
  shouldDisableSandbox,
  windowsBuildNumber,
} from '../src/core/platform';

describe('windowsBuildNumber', () => {
  it('取出第三段版本号', () => {
    expect(windowsBuildNumber('10.0.26200')).toBe(26200);
    expect(windowsBuildNumber('10.0.22631.4890')).toBe(22631);
  });

  it('格式异常时返回 0', () => {
    expect(windowsBuildNumber('')).toBe(0);
    expect(windowsBuildNumber('weird')).toBe(0);
    expect(windowsBuildNumber('10.0')).toBe(0);
  });
});

describe('shouldDisableSandbox', () => {
  it('Windows 11 25H2 及以上需要关闭沙箱', () => {
    expect(shouldDisableSandbox('win32', '10.0.26200')).toBe(true);
    expect(shouldDisableSandbox('win32', `10.0.${SANDBOX_BROKEN_BUILD}`)).toBe(true);
  });

  it('更旧的 Windows 不需要', () => {
    expect(shouldDisableSandbox('win32', '10.0.22631')).toBe(false);
    expect(shouldDisableSandbox('win32', '10.0.19045')).toBe(false);
  });

  it('非 Windows 一律不需要', () => {
    expect(shouldDisableSandbox('darwin', '23.0.0')).toBe(false);
    expect(shouldDisableSandbox('linux', '6.1.0')).toBe(false);
  });

  it('无法解析版本时不关闭沙箱', () => {
    expect(shouldDisableSandbox('win32', '')).toBe(false);
  });
});

describe('resolveNoSandbox', () => {
  it('环境变量可以强制开启或关闭', () => {
    expect(resolveNoSandbox('win32', '10.0.22631', '1')).toBe(true);
    expect(resolveNoSandbox('win32', '10.0.26200', '0')).toBe(false);
  });

  it('没有覆盖时按系统版本判断', () => {
    expect(resolveNoSandbox('win32', '10.0.26200', undefined)).toBe(true);
    expect(resolveNoSandbox('win32', '10.0.22631', undefined)).toBe(false);
  });
});
