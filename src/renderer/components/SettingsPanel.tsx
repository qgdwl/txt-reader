import { useEffect, useState } from 'react';
import type { Prefs, ReaderTheme } from '../../shared/types';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
  PAGE_MARGIN_MAX,
  PAGE_MARGIN_MIN,
  PARAGRAPH_SPACING_MAX,
  PARAGRAPH_SPACING_MIN,
} from '../../core/prefs';

interface SettingsPanelProps {
  prefs: Prefs;
  onChange: (patch: Partial<Prefs>) => void;
  onClose: () => void;
  /** 老板模式热键，形如 Control+Alt+B。 */
  hotkey: string;
  onHotkeyChange: (value: string) => Promise<boolean>;
  /** 老板模式背景浓度（0.2–1）。 */
  bossTint: number;
  onBossTintChange: (value: number) => Promise<unknown>;
  onResetPrefs: () => void;
  /** 选择背景图，返回选中的路径（取消返回 null）。 */
  onPickBackground: () => Promise<string | null>;
  /** 是否显示字号/行距/字体等排版项；PDF 没有重排空间，只保留主题与老板模式。 */
  showTypography?: boolean;
}

const WEIGHTS: Array<{ key: Prefs['fontWeight']; label: string }> = [
  { key: 'normal', label: '常规' },
  { key: 'medium', label: '中等' },
  { key: 'bold', label: '加粗' },
];

const THEMES: Array<{ key: ReaderTheme; label: string }> = [
  { key: 'light', label: '纸白' },
  { key: 'sepia', label: '羊皮纸' },
  { key: 'dark', label: '夜间' },
];

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

function describeKey(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join('+');
}

export function SettingsPanel({
  prefs,
  onChange,
  onClose,
  hotkey,
  onHotkeyChange,
  bossTint,
  onBossTintChange,
  onResetPrefs,
  onPickBackground,
  showTypography = true,
}: SettingsPanelProps) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.key === 'Escape') {
        setCapturing(false);
        return;
      }
      // 只按下修饰键时继续等待
      if (MODIFIER_KEYS.has(event.key)) return;
      const accelerator = describeKey(event);
      setCapturing(false);
      void onHotkeyChange(accelerator)
        .then((ok) => setError(ok ? null : '这个键被其他程序占用了，换一个试试'))
        .catch(() => setError('设置热键失败，请重试'));
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturing, onHotkeyChange]);

  return (
    <section className="settings" data-testid="settings">
      <header className="settings-head">
        <h2>设置</h2>
        <button type="button" className="ghost small" onClick={onClose}>
          收起
        </button>
      </header>

      <div className="settings-group">{showTypography ? '排版' : '外观'}</div>

      {showTypography && (
        <>
          <div className="setting-row">
            <label htmlFor="font-size">字号</label>
            <input
              id="font-size"
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={prefs.fontSize}
              onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
            />
            <span className="setting-value">{prefs.fontSize}</span>
          </div>

          <div className="setting-row">
            <label htmlFor="line-height">行距</label>
            <input
              id="line-height"
              type="range"
              min={LINE_HEIGHT_MIN}
              max={LINE_HEIGHT_MAX}
              step={0.05}
              value={prefs.lineHeight}
              onChange={(event) => onChange({ lineHeight: Number(event.target.value) })}
            />
            <span className="setting-value">{prefs.lineHeight.toFixed(2)}</span>
          </div>

          <div className="setting-row">
            <label htmlFor="page-margin">边距</label>
            <input
              id="page-margin"
              type="range"
              min={PAGE_MARGIN_MIN}
              max={PAGE_MARGIN_MAX}
              step={4}
              value={prefs.pageMargin}
              onChange={(event) => onChange({ pageMargin: Number(event.target.value) })}
            />
            <span className="setting-value">{prefs.pageMargin}</span>
          </div>

          <div className="setting-row">
            <label htmlFor="para-gap">段距</label>
            <input
              id="para-gap"
              type="range"
              min={PARAGRAPH_SPACING_MIN}
              max={PARAGRAPH_SPACING_MAX}
              step={0.05}
              value={prefs.paragraphSpacing}
              onChange={(event) => onChange({ paragraphSpacing: Number(event.target.value) })}
            />
            <span className="setting-value">{prefs.paragraphSpacing.toFixed(2)}</span>
          </div>

          <div className="setting-row">
            <label htmlFor="page-width">版心</label>
            <input
              id="page-width"
              type="range"
              min={PAGE_WIDTH_MIN}
              max={PAGE_WIDTH_MAX}
              step={20}
              value={prefs.pageWidth}
              onChange={(event) => onChange({ pageWidth: Number(event.target.value) })}
            />
            <span className="setting-value">{prefs.pageWidth}</span>
          </div>
        </>
      )}

      <div className="setting-row">
        <span className="setting-label">主题</span>
        <div className="segmented">
          {THEMES.map((theme) => (
            <button
              type="button"
              key={theme.key}
              className={prefs.theme === theme.key ? 'segmented-item active' : 'segmented-item'}
              onClick={() => onChange({ theme: theme.key })}
            >
              {theme.label}
            </button>
          ))}
        </div>
      </div>

      {showTypography && (
        <>
          <div className="setting-row">
            <span className="setting-label">字体</span>
            <div className="segmented">
              <button
                type="button"
                className={prefs.fontFamily === 'serif' ? 'segmented-item active' : 'segmented-item'}
                onClick={() => onChange({ fontFamily: 'serif' })}
              >
                宋体
              </button>
              <button
                type="button"
                className={prefs.fontFamily === 'sans' ? 'segmented-item active' : 'segmented-item'}
                onClick={() => onChange({ fontFamily: 'sans' })}
              >
                黑体
              </button>
              <button
                type="button"
                className={prefs.fontFamily === 'deng' ? 'segmented-item active' : 'segmented-item'}
                onClick={() => onChange({ fontFamily: 'deng' })}
              >
                等线
              </button>
            </div>
          </div>

          <div className="setting-row">
            <span className="setting-label">字重</span>
            <div className="segmented">
              {WEIGHTS.map((weight) => (
                <button
                  type="button"
                  key={weight.key}
                  className={prefs.fontWeight === weight.key ? 'segmented-item active' : 'segmented-item'}
                  onClick={() => onChange({ fontWeight: weight.key })}
                >
                  {weight.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="setting-row">
        <span className="setting-label">背景图</span>
        <button type="button" className="ghost small" onClick={() => void onPickBackground()}>
          {prefs.backgroundImage ? '更换' : '选择'}
        </button>
        {prefs.backgroundImage && (
          <button
            type="button"
            className="ghost small"
            onClick={() => onChange({ backgroundImage: null })}
          >
            清除
          </button>
        )}
      </div>

      {prefs.backgroundImage && (
        <div className="setting-row">
          <label htmlFor="bg-opacity">背景浓度</label>
          <input
            id="bg-opacity"
            type="range"
            min={0.05}
            max={0.6}
            step={0.05}
            value={prefs.backgroundOpacity}
            onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) })}
          />
          <span className="setting-value">{prefs.backgroundOpacity.toFixed(2)}</span>
        </div>
      )}

      <div className="settings-group">老板模式</div>

      <div className="setting-row">
        <span className="setting-label">热键</span>
        <button
          type="button"
          className={capturing ? 'hotkey-key capturing' : 'hotkey-key'}
          onClick={() => {
            setError(null);
            setCapturing(true);
          }}
        >
          {capturing ? '按下新的组合键…' : hotkey}
        </button>
      </div>

      <div className="setting-row">
        <label htmlFor="boss-tint">窗口透明度</label>
        <input
          id="boss-tint"
          type="range"
          min={0}
          max={75}
          step={5}
          value={Math.round((1 - bossTint) * 100)}
          onChange={(event) => void onBossTintChange(1 - Number(event.target.value) / 100)}
        />
        <span className="setting-value">{Math.round((1 - bossTint) * 100)}%</span>
      </div>

      {error && <p className="settings-error">{error}</p>}
      <p className="hint">
        按 Esc 取消录制。带修饰键的组合键全局生效；单键（如 E、F9）只在窗口激活时生效，避免打断别处打字。
      </p>
      <p className="hint">
        老板模式靠整窗透明度实现：桌面能透过来，文字也会跟着变淡（Windows 上有边框的窗口没法只透背景）。
        数值越大越透，最多 75%。
      </p>

      <div className="settings-group">通用</div>
      <div className="setting-row">
        <button type="button" className="ghost small" onClick={onResetPrefs}>
          恢复默认排版
        </button>
      </div>
    </section>
  );
}
