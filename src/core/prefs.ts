import type { FontFamilyKey, FontWeightKey, Prefs, ReaderTheme } from '../shared/types';

export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 40;
export const LINE_HEIGHT_MIN = 1.2;
export const LINE_HEIGHT_MAX = 2.6;
export const PAGE_MARGIN_MIN = 16;
export const PAGE_MARGIN_MAX = 96;
export const PARAGRAPH_SPACING_MIN = 0.3;
export const PARAGRAPH_SPACING_MAX = 2;
export const PAGE_WIDTH_MIN = 520;
export const PAGE_WIDTH_MAX = 1200;

export const DEFAULT_PREFS: Prefs = {
  fontSize: 19,
  lineHeight: 1.85,
  fontFamily: 'serif',
  fontWeight: 'normal',
  theme: 'light',
  pageWidth: 900,
  paragraphSpacing: 1,
  pageMargin: 56,
  backgroundImage: null,
  backgroundOpacity: 0.18,
};

const THEMES: readonly ReaderTheme[] = ['light', 'sepia', 'dark'];
const FAMILIES: readonly FontFamilyKey[] = ['serif', 'sans', 'deng'];
const WEIGHTS: readonly FontWeightKey[] = ['normal', 'medium', 'bold'];

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 把任意来源（旧版本、损坏的配置文件）收敛成合法偏好。 */
export function normalizePrefs(input: Partial<Prefs> | null | undefined): Prefs {
  const source = input ?? {};
  const theme = THEMES.includes(source.theme as ReaderTheme)
    ? (source.theme as ReaderTheme)
    : DEFAULT_PREFS.theme;
  const fontFamily = FAMILIES.includes(source.fontFamily as FontFamilyKey)
    ? (source.fontFamily as FontFamilyKey)
    : DEFAULT_PREFS.fontFamily;
  const fontWeight = WEIGHTS.includes(source.fontWeight as FontWeightKey)
    ? (source.fontWeight as FontWeightKey)
    : DEFAULT_PREFS.fontWeight;

  return {
    fontSize: Math.round(
      numberInRange(source.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, DEFAULT_PREFS.fontSize),
    ),
    lineHeight: round2(
      numberInRange(source.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, DEFAULT_PREFS.lineHeight),
    ),
    fontFamily,
    fontWeight,
    theme,
    pageWidth: Math.round(
      numberInRange(source.pageWidth, PAGE_WIDTH_MIN, PAGE_WIDTH_MAX, DEFAULT_PREFS.pageWidth),
    ),
    backgroundImage:
      typeof source.backgroundImage === 'string' && source.backgroundImage.trim().length > 0
        ? source.backgroundImage
        : null,
    backgroundOpacity: round2(
      numberInRange(source.backgroundOpacity, 0, 1, DEFAULT_PREFS.backgroundOpacity),
    ),
    pageMargin: Math.round(
      numberInRange(source.pageMargin, PAGE_MARGIN_MIN, PAGE_MARGIN_MAX, DEFAULT_PREFS.pageMargin),
    ),
    paragraphSpacing: round2(
      numberInRange(
        source.paragraphSpacing,
        PARAGRAPH_SPACING_MIN,
        PARAGRAPH_SPACING_MAX,
        DEFAULT_PREFS.paragraphSpacing,
      ),
    ),
  };
}

export function patchPrefs(current: Prefs, patch: Partial<Prefs>): Prefs {
  return normalizePrefs({ ...current, ...patch });
}
