import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { BossState } from '../../shared/api';
import type { BookContent, Bookmark, Prefs, Progress } from '../../shared/types';
import { clampPage, fitPageSize, pdfPageFromProgress, pdfPageLabel, pdfPercent } from '../../core/pdf';
import { formatPercent } from '../../core/progress';
import { DEFAULT_PREFS } from '../../core/prefs';
import { PDFJS_ASSETS, pdfjs } from '../pdfjs';
import { SettingsPanel } from './SettingsPanel';

interface PdfReaderProps {
  content: BookContent;
  prefs: Prefs;
  boss: BossState;
  onPrefsChange: (patch: Partial<Prefs>) => void;
  onToggleBoss: (on?: boolean) => void;
  onBack: () => void;
}

/** 已渲染页面的缓存：翻页时直接复用，不重新解码。 */
interface CachedPage {
  /** 渲染时的可用区域尺寸（变了就作废）。 */
  key: string;
  canvas: HTMLCanvasElement;
  /** 在屏幕上的 CSS 宽高。 */
  width: number;
  height: number;
}

/** 缓存页数：当前页 + 前后各一页 + 来回翻时的余量。 */
const MAX_CACHE_PAGES = 8;
/** 单张画布的像素上限：超大页面按 DPR 渲染会撑爆显存。 */
const MAX_CANVAS_PIXELS = 24_000_000;
/** 与 CSS 里 .pdf-viewport 的 padding 保持一致（见 styles.css）。 */
const VIEWPORT_PADDING = 20;

function describePdfError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'PasswordException' || /password/i.test(message)) {
    return '这个 PDF 需要密码（或已加密），目前打不开。';
  }
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) {
    return '这个 PDF 文件已损坏，打不开。';
  }
  if (message.includes('PDF 文件已丢失')) return message;
  return `打开 PDF 失败：${message}`;
}

function isCancelError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /cancel/i.test(text);
}

/**
 * PDF 阅读视图：一页一屏。
 *
 * 和 TXT/EPUB 的滚动分页相反，PDF 按页渲染成 canvas：
 * 只渲染当前页与前后各一页，翻页就是换页；进度与书签都存页码（0 基）。
 */
export function PdfReader({
  content,
  prefs,
  boss,
  onPrefsChange,
  onToggleBoss,
  onBack,
}: PdfReaderProps) {
  const { book } = content;

  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(0);
  const [percent, setPercent] = useState(0);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [attempt, setAttempt] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showMarks, setShowMarks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const pageRef = useRef(0);
  const pageCountRef = useRef(0);
  const cacheRef = useRef(new Map<number, CachedPage>());
  const inflightRef = useRef(new Map<number, Promise<CachedPage | null>>());
  const cacheKeyRef = useRef('');
  const renderTasksRef = useRef(new Set<RenderTask>());
  const wheelAt = useRef(0);

  /* ---------------- 可用区域与缩放 ---------------- */

  const measure = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    const width = Math.max(0, node.clientWidth - VIEWPORT_PADDING * 2);
    const height = Math.max(0, node.clientHeight - VIEWPORT_PADDING * 2);
    setBox((previous) =>
      Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
        ? previous
        : { width, height },
    );
  }, []);

  useEffect(() => {
    measure();
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    let timer: number | null = null;
    const observer = new ResizeObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(measure, 120);
    });
    observer.observe(node);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [measure]);

  /** 打开 PDF 并恢复上次页码。 */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReady(false);
    setPageCount(0);
    setPage(0);
    setRenderState('loading');
    setDisplaySize({ width: 0, height: 0 });
    pageRef.current = 0;
    pageCountRef.current = 0;
    cacheRef.current.clear();
    inflightRef.current.clear();
    cacheKeyRef.current = '';

    void (async () => {
      try {
        const buffer = await window.reader.pdf.read(book.id);
        if (cancelled) return;
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(buffer),
          ...PDFJS_ASSETS,
        });
        loadingTaskRef.current = loadingTask;
        const loaded = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        docRef.current = loaded;
        pageCountRef.current = loaded.numPages;
        setPageCount(loaded.numPages);

        let saved: Progress | null = null;
        try {
          saved = await window.reader.progress.get(book.id);
        } catch {
          saved = null;
        }
        const start = pdfPageFromProgress(saved?.position, loaded.numPages);
        pageRef.current = start;
        setPage(start);
        setPercent(pdfPercent(start, loaded.numPages));
        setReady(true);
        setLoading(false);

        // 第一次打开时把页数回写，书架就能显示「N 页」
        if (book.pageCount !== loaded.numPages) {
          void window.reader.pdf
            .savePageCount(book.id, loaded.numPages)
            .catch(() => undefined);
        }
      } catch (err) {
        if (cancelled) return;
        setError(describePdfError(err));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      for (const task of renderTasksRef.current) {
        try {
          task.cancel();
        } catch {
          // 已经结束的任务取消失败可以直接忽略
        }
      }
      renderTasksRef.current.clear();
      const current = docRef.current;
      docRef.current = null;
      const task = loadingTaskRef.current;
      loadingTaskRef.current = null;
      if (current && task) void task.destroy();
    };
    // pageCount 回写不会改动当前 content，依赖 book.id 即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  /* ---------------- 渲染 ---------------- */

  const renderPage = useCallback(
    (pageNumber: number): Promise<CachedPage | null> => {
      const pdfDocument = docRef.current;
      const total = pageCountRef.current;
      if (!pdfDocument || total <= 0 || pageNumber < 0 || pageNumber >= total) {
        return Promise.resolve(null);
      }
      if (box.width <= 0 || box.height <= 0) return Promise.resolve(null);

      const dpr = window.devicePixelRatio || 1;
      const key = `${Math.round(box.width)}x${Math.round(box.height)}@${dpr}`;
      if (cacheKeyRef.current !== key) {
        cacheKeyRef.current = key;
        cacheRef.current.clear();
        inflightRef.current.clear();
      }
      const cached = cacheRef.current.get(pageNumber);
      if (cached) return Promise.resolve(cached);
      const pending = inflightRef.current.get(pageNumber);
      if (pending) return pending;

      const task = (async (): Promise<CachedPage | null> => {
        const pdfPage = await pdfDocument.getPage(pageNumber + 1);
        if (cacheKeyRef.current !== key) return null;
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = fitPageSize(base.width, base.height, box.width, box.height);
        if (fit.width <= 0 || fit.height <= 0) return null;

        // 按设备像素渲染，文字才清晰；超大页面降倍率，避免画布超过显存上限
        let renderScale = fit.scale * dpr;
        const pixels = base.width * renderScale * base.height * renderScale;
        if (pixels > MAX_CANVAS_PIXELS) {
          renderScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
        }
        const viewport = pdfPage.getViewport({ scale: renderScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建画布');

        const renderTask = pdfPage.render({ canvasContext: context, canvas, viewport });
        renderTasksRef.current.add(renderTask);
        try {
          await renderTask.promise;
        } finally {
          renderTasksRef.current.delete(renderTask);
        }
        if (cacheKeyRef.current !== key) return null;

        const entry: CachedPage = { key, canvas, width: fit.width, height: fit.height };
        cacheRef.current.set(pageNumber, entry);
        while (cacheRef.current.size > MAX_CACHE_PAGES) {
          const oldest = cacheRef.current.keys().next().value;
          if (oldest === undefined || oldest === pageNumber) break;
          cacheRef.current.delete(oldest);
        }
        return entry;
      })().finally(() => {
        inflightRef.current.delete(pageNumber);
      });

      inflightRef.current.set(pageNumber, task);
      return task;
    },
    [box.height, box.width],
  );

  // 当前页：先查缓存，没有就把 canvas 画出来
  useEffect(() => {
    if (!ready || pageCount === 0) return;
    let cancelled = false;
    setRenderState('loading');
    void renderPage(page)
      .then((entry) => {
        if (cancelled || !entry) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = entry.canvas.width;
        canvas.height = entry.canvas.height;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(entry.canvas, 0, 0);
        setDisplaySize({ width: entry.width, height: entry.height });
        setRenderState('ready');
      })
      .catch((err) => {
        if (cancelled || isCancelError(err)) return;
        setRenderState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, page, pageCount, ready, renderPage]);

  // 预渲染前后各一页：翻页时不用等解码
  useEffect(() => {
    if (!ready || pageCount === 0) return;
    const timer = window.setTimeout(() => {
      void renderPage(page + 1).catch(() => undefined);
      void renderPage(page - 1).catch(() => undefined);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [page, pageCount, ready, renderPage]);

  /* ---------------- 翻页与进度 ---------------- */

  const goToPage = useCallback((target: number) => {
    const total = pageCountRef.current;
    if (total <= 0) return;
    const next = clampPage(target, total);
    if (next === pageRef.current) return;
    pageRef.current = next;
    setPage(next);
  }, []);

  const nextPage = useCallback(() => goToPage(pageRef.current + 1), [goToPage]);
  const prevPage = useCallback(() => goToPage(pageRef.current - 1), [goToPage]);

  const persist = useCallback(
    (target: number) => {
      const total = pageCountRef.current;
      if (total <= 0) return;
      const pct = pdfPercent(target, total);
      setPercent(pct);
      void window.reader.progress.set({
        bookId: book.id,
        position: { offset: target },
        percent: pct,
        updatedAt: Date.now(),
      });
    },
    [book.id],
  );

  // 页码稳定后立刻更新百分比；落盘防抖，避免连翻时频繁写文件
  useEffect(() => {
    if (!ready || pageCount === 0) return;
    setPercent(pdfPercent(page, pageCount));
    const timer = window.setTimeout(() => persist(page), 400);
    return () => window.clearTimeout(timer);
  }, [page, pageCount, persist, ready]);

  // 离开时补一次进度
  useEffect(
    () => () => {
      if (pageCountRef.current > 0) persist(pageRef.current);
    },
    [persist],
  );

  /* ---------------- 书签 ---------------- */

  useEffect(() => {
    let alive = true;
    void window.reader.bookmarks
      .list(book.id)
      .then((list) => {
        if (alive) setBookmarks(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [book.id]);

  const addBookmark = useCallback(async () => {
    const total = pageCountRef.current;
    const index = pageRef.current;
    const created = await window.reader.bookmarks.add({
      bookId: book.id,
      // PDF 的 offset 就是页码
      offset: index,
      chapterTitle: `第 ${index + 1} 页`,
      excerpt: total > 0 ? `第 ${index + 1} / ${total} 页` : '',
    });
    setBookmarks((list) =>
      [...list.filter((item) => item.id !== created.id), created].sort((a, b) => a.offset - b.offset),
    );
    setShowMarks(true);
  }, [book.id]);

  const removeBookmark = useCallback(
    async (id: string) => {
      await window.reader.bookmarks.remove(book.id, id);
      setBookmarks((list) => list.filter((item) => item.id !== id));
    },
    [book.id],
  );

  /* ---------------- 阅读时长 ---------------- */

  useEffect(() => {
    const startedAt = Date.now();
    let lastTick = startedAt;
    let seconds = 0;
    const tick = () => {
      const now = Date.now();
      const delta = Math.round((now - lastTick) / 1000);
      lastTick = now;
      if (delta > 0 && delta < 120) seconds += delta;
    };
    const timer = window.setInterval(tick, 15000);
    return () => {
      tick();
      window.clearInterval(timer);
      if (seconds >= 5) {
        void window.reader.stats.addSession({ bookId: book.id, startedAt, seconds });
      }
    };
  }, [book.id]);

  /* ---------------- 背景图 ---------------- */

  useEffect(() => {
    let cancelled = false;
    if (!prefs.backgroundImage) {
      setBgUrl(null);
      return;
    }
    void window.reader.image.data(prefs.backgroundImage).then((url) => {
      if (!cancelled) setBgUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [prefs.backgroundImage]);

  /* ---------------- 键盘 ---------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showSettings) setShowSettings(false);
        else if (showMarks) setShowMarks(false);
        else if (boss.boss) onToggleBoss(false);
        else onBack();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (
        event.key === 'ArrowRight' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        event.key === ' '
      ) {
        event.preventDefault();
        nextPage();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        prevPage();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [boss.boss, nextPage, onBack, onToggleBoss, prevPage, showMarks, showSettings]);

  const status = pageCount > 0 ? pdfPageLabel(page, pageCount) : '正在打开 PDF…';
  const footerStatus =
    pageCount > 0 ? `${pdfPageLabel(page, pageCount)} · ${formatPercent(percent)}` : status;
  const atFirst = page === 0;
  const atLast = pageCount > 0 && page >= pageCount - 1;

  return (
    <>
      {bgUrl && (
        <div
          className="page-bg"
          style={{ backgroundImage: `url("${bgUrl}")`, opacity: prefs.backgroundOpacity }}
        />
      )}
      <div
        className={boss.boss ? 'reader boss pdf-reader' : 'reader pdf-reader'}
        data-testid="reader"
      >
        {!boss.boss && (
          <div className="reader-progress" aria-hidden="true">
            <span style={{ width: `${percent * 100}%` }} />
          </div>
        )}

        {!boss.boss && (
          <header className="reader-bar">
            <button type="button" className="ghost" onClick={onBack}>
              ← 书架
            </button>
            <div className="reader-heading">
              <strong title={book.title}>{book.title}</strong>
              <span>PDF · {status}</span>
            </div>
            <div className="reader-actions">
              <button type="button" className="ghost" onClick={() => onToggleBoss(true)}>
                老板模式
              </button>
              <button
                type="button"
                className={showMarks ? 'ghost active' : 'ghost'}
                onClick={() => void addBookmark()}
              >
                书签
              </button>
              <button
                type="button"
                className={showSettings ? 'ghost active' : 'ghost'}
                onClick={() => setShowSettings((value) => !value)}
              >
                设置
              </button>
            </div>
          </header>
        )}

        <div className="reader-main">
          {!boss.boss && showMarks && (
            <aside className="toc pdf-marks" data-testid="pdf-marks">
              <div className="mark-block">
                <div className="mark-title">
                  书签
                  <button
                    type="button"
                    className="mark-close"
                    onClick={() => setShowMarks(false)}
                    title="收起书签"
                  >
                    ×
                  </button>
                </div>
                {bookmarks.length === 0 ? (
                  <p className="pdf-marks-empty">还没有书签：点顶部「书签」记下当前页</p>
                ) : (
                  bookmarks.map((mark) => (
                    <div key={mark.id} className="mark-row">
                      <button
                        type="button"
                        className="mark-jump"
                        onClick={() => goToPage(mark.offset)}
                        title={mark.excerpt}
                      >
                        <span className="mark-chapter">{mark.chapterTitle}</span>
                        <span className="mark-excerpt">{mark.excerpt}</span>
                      </button>
                      <button
                        type="button"
                        className="mark-remove"
                        onClick={() => void removeBookmark(mark.id)}
                        title="删除书签"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </aside>
          )}

          <div
            className="pdf-viewport"
            ref={viewportRef}
            data-testid="pdf-viewer"
            data-page={pageCount > 0 ? page + 1 : 0}
            data-page-count={pageCount}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (event.clientY - rect.top < rect.height / 2) prevPage();
              else nextPage();
            }}
            onWheel={(event) => {
              const now = Date.now();
              if (now - wheelAt.current < 220) return;
              if (Math.abs(event.deltaY) < 4) return;
              wheelAt.current = now;
              if (event.deltaY < 0) prevPage();
              else nextPage();
            }}
          >
            <div
              className="pdf-stage"
              style={
                displaySize.width > 0
                  ? { width: `${displaySize.width}px`, height: `${displaySize.height}px` }
                  : undefined
              }
            >
              <canvas
                ref={canvasRef}
                className="pdf-canvas"
                style={{
                  width: displaySize.width > 0 ? `${displaySize.width}px` : undefined,
                  height: displaySize.height > 0 ? `${displaySize.height}px` : undefined,
                  opacity: displaySize.width > 0 ? 1 : 0,
                }}
              />
            </div>

            {error ? (
              <div className="pdf-error" onClick={(event) => event.stopPropagation()}>
                <p>{error}</p>
                <button type="button" className="ghost" onClick={onBack}>
                  返回书架
                </button>
              </div>
            ) : null}

            {!error && (loading || renderState === 'loading') && (
              <div className="pdf-loading">
                {loading ? '正在打开 PDF…' : `正在渲染第 ${page + 1} 页…`}
              </div>
            )}

            {!error && !loading && renderState === 'error' && (
              <div className="pdf-error" onClick={(event) => event.stopPropagation()}>
                <p>这一页渲染失败。</p>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setRenderState('loading');
                    setAttempt((value) => value + 1);
                  }}
                >
                  重试
                </button>
              </div>
            )}
          </div>

          {showSettings && !boss.boss && (
            <SettingsPanel
              prefs={prefs}
              onChange={onPrefsChange}
              onClose={() => setShowSettings(false)}
              hotkey={boss.hotkey}
              onHotkeyChange={async (value) => window.reader.window.setHotkey(value)}
              bossTint={boss.opacity}
              onBossTintChange={async (value) => window.reader.window.setBossTint(value)}
              onResetPrefs={() => onPrefsChange({ ...DEFAULT_PREFS })}
              showTypography={false}
              onPickBackground={async () => {
                const picked = await window.reader.image.pick();
                if (picked) onPrefsChange({ backgroundImage: picked });
                return picked;
              }}
            />
          )}
        </div>

        {!boss.boss && (
          <footer className="reader-foot" data-testid="reader-footer">
            <button type="button" className="ghost" onClick={prevPage} disabled={atFirst}>
              ← 上一页
            </button>
            <span className="reader-status">{footerStatus}</span>
            <button type="button" className="ghost" onClick={nextPage} disabled={atLast}>
              下一页 →
            </button>
          </footer>
        )}
      </div>
    </>
  );
}
