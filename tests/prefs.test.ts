import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  normalizePrefs,
  patchPrefs,
} from '../src/core/prefs';

describe('normalizePrefs', () => {
  it('没有输入时返回默认值', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({})).toEqual(DEFAULT_PREFS);
  });

  it('字号越界收敛并取整', () => {
    expect(normalizePrefs({ fontSize: 999 }).fontSize).toBe(FONT_SIZE_MAX);
    expect(normalizePrefs({ fontSize: 1 }).fontSize).toBe(FONT_SIZE_MIN);
    expect(normalizePrefs({ fontSize: 20.6 }).fontSize).toBe(21);
  });

  it('行距越界收敛并保留两位小数', () => {
    expect(normalizePrefs({ lineHeight: 10 }).lineHeight).toBe(LINE_HEIGHT_MAX);
    expect(normalizePrefs({ lineHeight: 0.1 }).lineHeight).toBe(LINE_HEIGHT_MIN);
    expect(normalizePrefs({ lineHeight: 1.856 }).lineHeight).toBe(1.86);
  });

  it('段间距越界收敛并保留两位小数', () => {
    expect(normalizePrefs({ paragraphSpacing: 5 }).paragraphSpacing).toBe(2);
    expect(normalizePrefs({ paragraphSpacing: 0 }).paragraphSpacing).toBe(0.3);
    expect(normalizePrefs({ paragraphSpacing: 1.234 }).paragraphSpacing).toBe(1.23);
  });

  it('背景图与浓度规范化', () => {
    expect(normalizePrefs({ backgroundImage: 'C:/a.png' }).backgroundImage).toBe('C:/a.png');
    expect(normalizePrefs({ backgroundImage: '   ' }).backgroundImage).toBeNull();
    expect(normalizePrefs({ backgroundOpacity: 9 }).backgroundOpacity).toBe(1);
    expect(normalizePrefs({ backgroundOpacity: 0.234 }).backgroundOpacity).toBe(0.23);
    expect(DEFAULT_PREFS.backgroundOpacity).toBe(0.18);
  });

  it('默认段间距与版心', () => {
    expect(DEFAULT_PREFS.paragraphSpacing).toBe(1);
    expect(DEFAULT_PREFS.pageWidth).toBe(900);
  });

  it('非法枚举回退默认值', () => {
    const prefs = normalizePrefs({
      theme: 'rainbow' as never,
      fontFamily: 'mono' as never,
    });
    expect(prefs.theme).toBe(DEFAULT_PREFS.theme);
    expect(prefs.fontFamily).toBe(DEFAULT_PREFS.fontFamily);
  });

  it('保留合法值', () => {
    const prefs = normalizePrefs({ theme: 'dark', fontFamily: 'sans', fontSize: 24 });
    expect(prefs.theme).toBe('dark');
    expect(prefs.fontFamily).toBe('sans');
    expect(prefs.fontSize).toBe(24);
  });

  it('字体可选宋体 / 黑体 / 等线，非法值回退宋体', () => {
    expect(normalizePrefs({ fontFamily: 'deng' }).fontFamily).toBe('deng');
    expect(normalizePrefs({ fontFamily: 'serif' }).fontFamily).toBe('serif');
    expect(normalizePrefs({ fontFamily: 'kai' as never }).fontFamily).toBe('serif');
  });

  it('字重可选常规 / 中等 / 加粗，缺省是常规', () => {
    expect(normalizePrefs({ fontWeight: 'bold' }).fontWeight).toBe('bold');
    expect(normalizePrefs({ fontWeight: 'medium' }).fontWeight).toBe('medium');
    expect(normalizePrefs({ fontWeight: 'heavy' as never }).fontWeight).toBe('normal');
    expect(normalizePrefs({}).fontWeight).toBe('normal');
  });
});

describe('patchPrefs', () => {
  it('只改传入的字段', () => {
    const next = patchPrefs(DEFAULT_PREFS, { theme: 'sepia' });
    expect(next.theme).toBe('sepia');
    expect(next.fontSize).toBe(DEFAULT_PREFS.fontSize);
  });

  it('补丁值同样被规范化', () => {
    const next = patchPrefs(DEFAULT_PREFS, { fontSize: 999 });
    expect(next.fontSize).toBe(FONT_SIZE_MAX);
  });
});
