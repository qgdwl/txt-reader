import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BossState } from '../../shared/api';
import type { BookContent, BookImage, Bookmark, Prefs } from '../../shared/types';
import { makeExcerpt } from '../../core/bookmarks';
import { IMAGE_PLACEHOLDER } from '../../core/images';
import { chapterBody, chapterHasBody, nearestChapterWithBody } from '../../core/chapters';
import { DEFAULT_PREFS } from '../../core/prefs';
import {
  chapterIndexAt,
  offsetToPercent,
  pageIndexForOffset,
  resolveSavedOffset,
} from '../../core/locator';
import {
  bodyStartOffset,
  buildPageOrigins,
  locateY,
  offsetAtNode,
  pageOffset,
  relativeOffset,
  totalPages,
} from '../../core/paging';
import { formatPercent } from '../../core/progress';
import { searchText } from '../../core/search';
import type { SearchMatch } from '../../core/search';
import { SettingsPanel } from './SettingsPanel';

interface ReaderProps {
  content: BookContent;
  prefs: Prefs;
  boss: BossState;
  onPrefsChange: (patch: Partial<Prefs>) => void;
  onToggleBoss: (on?: boolean) => void;
  onBack: () => void;
}

export function Reader({
  content,
  prefs,
  boss,
  onPrefsChange,
  onToggleBoss,
  onBack,
}: ReaderProps) {
  const { book, text, chapters } = content;
  const images = content.images ?? [];
  const total = chapters.length;
  const textLength = text.length;

  const [chapterIndex, setChapterIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageStarts, setPageStarts] = useState<number[]>([0]);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  /** 书内图片的 data URL 缓存（按 media 文件名）。 */
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const imageCache = useRef(new Map<string, string>());
  const wheelAt = useRef(0);
  const layoutToken = useRef(0);
  const pageStartsRef = useRef<number[]>([0]);
  const pageTopsRef = useRef<number[]>([0]);
  /** 每页的可见高度：正好从本页第一行顶到下一页第一行顶，页底不会切到字。 */
  const pageSpansRef = useRef<number[]>([]);
  const [percent, setPercent] = useState(0);
  /** 全书页数统计：每章页数 + 总页数，后台逐章测量，完成后才能显示「全书第几页」。 */
  const bookStatsRef = useRef<{ counts: number[]; total: number } | null>(null);
  const [, setBookStatsVersion] = useState(0);
  const measureBookPagesRef = useRef<() => void>(() => undefined);
  const bookMeasureToken = useRef(0);
  const bookSignatureRef = useRef('');
  const bookRunningRef = useRef(false);
  const [showToc, setShowToc] = useState(total > 1);
  const [showSettings, setShowSettings] = useState(false);
  const [ready, setReady] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [highlight, setHighlight] = useState<{ from: number; to: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  /** 待恢复的绝对偏移；分页算完后消费掉。 */
  const pendingOffset = useRef<number | null>(null);
  const pageRef = useRef(0);
  const chapterRef = useRef(0);

  const current = chapters[chapterIndex] ?? chapters[0];
  const body = current ? chapterBody(text, current) : '';
  const paragraphs = useMemo(() => body.split('\n'), [body]);
  const bodyStart = current ? bodyStartOffset(current.start, current.end, body.length) : 0;
  /** 占位符绝对偏移 → 图片元数据。 */
  const imagesByOffset = useMemo(() => {
    const map = new Map<number, BookImage>();
    for (const image of images) map.set(image.offset, image);
    return map;
  }, [images]);

  // 只加载当前章用到的图片，按文件名缓存，翻回上一章不用重新读
  useEffect(() => {
    let cancelled = false;
    const end = bodyStart + body.length;
    const needed = new Set<string>();
    for (const image of images) {
      if (image.offset >= bodyStart && image.offset < end) needed.add(image.file);
    }
    const missing = [...needed].filter((file) => !imageCache.current.has(file));
    if (missing.length === 0) {
      if (Object.keys(imageUrls).length === 0 && imageCache.current.size > 0) {
        setImageUrls(Object.fromEntries(imageCache.current));
      }
      return;
    }
    void (async () => {
      for (const file of missing) {
        const url = await window.reader.image.book(book.id, file);
        if (cancelled) return;
        if (url) imageCache.current.set(file, url);
      }
      if (!cancelled) setImageUrls(Object.fromEntries(imageCache.current));
    })();
    return () => {
      cancelled = true;
    };
    // imageUrls 只用于首次回填，不参与依赖，避免加载完又触发一轮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, body.length, bodyStart, images]);

  /** 一页的高度 = 取景框的真实高度（上下留白在框外，不参与分页）。 */
  const pageHeight = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return 400;
    // 视口高度含上下留白，分页只按「真正能放字的高度」算
    return Math.max(160, viewport.clientHeight - prefs.pageMargin * 2);
  }, [prefs.pageMargin]);

  /**
   * 竖向分页：正文是一条连续的竖长内容（横排文字），
   * 一页 = 取景框一屏，翻页就是让取景框滚到下一屏，文字本身不动。
   */
  const layout = useCallback(() => {
    const frame = frameRef.current;
    const columns = columnsRef.current;
    if (!frame || !columns) return;

    const height = pageHeight();
    // 图片按「一屏高」封顶：先告诉样式当前页高，图片块才能预先占好位置
    columns.style.setProperty('--page-h', `${height}px`);
    // 末尾补一屏高的空白：最后一页能滚到自己的页首，下方留白而不是被浏览器夹到底部
    columns.style.paddingBottom = `${height}px`;
    // 统一用「取景框的滚动坐标」测量：origin 会直接拿去设 scrollTop，
    // 两套坐标混用会因为框内顶部有空隙而错位（曾导致整页文字下移、页首切字）
    const frameRect = frame.getBoundingClientRect();
    const baseY = frameRect.top - frame.scrollTop;

    // 收集每一行的位置：用每段文字的矩形（一个矩形就是一行）
    const lineBoxes: Array<{ top: number; bottom: number }> = [];
    const boxes: Array<{ top: number; height: number }> = [];
    Array.from(columns.children).forEach((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      boxes.push({ top: rect.top - baseY, height: rect.height });
      const range = document.createRange();
      range.selectNodeContents(element);
      for (const lineRect of Array.from(range.getClientRects())) {
        lineBoxes.push({
          top: lineRect.top - baseY,
          bottom: lineRect.bottom - baseY,
        });
      }
      // 图片块没有文字，Range 量不到；单独把它的矩形当成一个「高行盒」
      const media = element.querySelector('img, .book-image-frame');
      if (media) {
        const mediaRect = media.getBoundingClientRect();
        if (mediaRect.height > 0) {
          lineBoxes.push({ top: mediaRect.top - baseY, bottom: mediaRect.bottom - baseY });
        }
      }
    });

    // 内容高度 = 最后一个行盒的 bottom（scrollHeight 会被 flex 拉伸污染）
    const contentHeight = lineBoxes.length
      ? lineBoxes.reduce((max, line) => Math.max(max, line.bottom), 0) + 24
      : columns.scrollHeight;

    // 页首吸附到行边界；起点已在内容之外的页一律丢弃，避免空白页
    const origins = buildPageOrigins(lineBoxes, height, contentHeight).filter(
      (top) => top < contentHeight - 8,
    );
    if (origins.length === 0) origins.push(0);
    const count = origins.length;

    // 每页的高度 = 下一页页首 - 本页页首；最后一页到内容末尾。
    // 这样页底永远落在两行之间，不会把下一行切成半截。
    const spans: number[] = origins.map((top, index) => {
      const end = index + 1 < origins.length ? origins[index + 1] : Math.max(top + 1, contentHeight);
      return Math.max(24, end - top);
    });

    const starts: number[] = origins.map((top) => {
      const { index, ratio } = locateY(boxes, top);
      return offsetAtNode(paragraphs, index, Math.round((paragraphs[index]?.length ?? 0) * ratio));
    });
    if (starts.length === 0) starts.push(0);
    starts[0] = 0;
    for (let index = 1; index < starts.length; index += 1) {
      if (starts[index] <= starts[index - 1]) starts[index] = starts[index - 1] + 1;
    }

    // 页码由「当前字符偏移」反查，不沿用可能已经过期的 page
    const anchor = pendingOffset.current ?? bodyStart + (pageStartsRef.current[pageRef.current] ?? 0);
    pendingOffset.current = null;

    pageStartsRef.current = starts;
    pageTopsRef.current = origins;
    pageSpansRef.current = spans;
    setPageStarts(starts);
    setPageCount(count);

    let next = pageIndexForOffset(starts, relativeOffset(anchor, bodyStart));
    next = Math.min(Math.max(0, next), count - 1);
    pageRef.current = next;
    setPage(next);
    // 翻页 = 移动取景框：框高裁到这一页的行高，滚动位置对准页首，不做整体位移
    frame.style.height = `${spans[next] ?? height}px`;
    frame.scrollTop = origins[next] ?? 0;

    // 排版稳定后再后台统计全书页数（同尺寸/同字号时不会重复算）
    window.setTimeout(() => measureBookPagesRef.current(), 400);

    if ((window as unknown as { __READER_DEBUG__?: boolean }).__READER_DEBUG__) {
      (window as unknown as { __pagingDebug?: unknown }).__pagingDebug = {
        origins,
        spans,
        boxes,
        pageH: height,
        contentHeight,
        scrollTop: frame.scrollTop,
      };
      console.log('[layout]', JSON.stringify({
        frameH: frame.clientHeight,
        pageH: height,
        contentH: contentHeight,
        count,
        page: next,
        top: origins[next] ?? 0,
        origins: origins.slice(0, 5),
      }));
    }
  }, [bodyStart, pageHeight, paragraphs]);

  /**
   * 后台统计全书页数：把每一章的正文塞进一个离屏、同宽同字号的容器里量行盒，
   * 再用和正文完全相同的分页算法算页数。分片执行，不阻塞翻页。
   */
  const measureBookPages = useCallback(() => {
    if (boss.boss) return;
    const frame = frameRef.current;
    const columns = columnsRef.current;
    if (!frame || !columns) return;
    const height = pageHeight();
    const width = columns.getBoundingClientRect().width;
    const fontFamily =
      prefs.fontFamily === 'serif'
        ? 'var(--font-serif)'
        : prefs.fontFamily === 'deng'
          ? 'var(--font-deng)'
          : 'var(--font-sans)';
    const fontWeight = prefs.fontWeight === 'bold' ? '700' : prefs.fontWeight === 'medium' ? '500' : '400';
    const signature = [
      Math.round(width),
      Math.round(height),
      prefs.fontSize,
      prefs.lineHeight,
      fontFamily,
      fontWeight,
      prefs.paragraphSpacing,
    ].join('|');
    // 同一套排版已经在算、或者已经算完了，就不再重复跑
    if (signature === bookSignatureRef.current && (bookStatsRef.current || bookRunningRef.current)) return;
    bookSignatureRef.current = signature;
    bookRunningRef.current = true;

    const token = ++bookMeasureToken.current;
    const host = document.createElement('div');
    host.className = 'page-columns book-measure';
    // 必须离屏且脱离文档流，否则会把整个页面撑长、干扰阅读区排版
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.visibility = 'hidden';
    host.style.pointerEvents = 'none';
    host.style.width = `${width}px`;
    host.style.fontSize = `${prefs.fontSize}px`;
    host.style.lineHeight = String(prefs.lineHeight);
    host.style.fontFamily = fontFamily;
    host.style.fontWeight = fontWeight;
    host.style.setProperty('--para-gap', `${prefs.paragraphSpacing}em`);
    document.body.appendChild(host);

    const counts = new Array<number>(chapters.length).fill(0);
    let index = 0;

    const measureOne = (chapterIndex: number) => {
      const chapter = chapters[chapterIndex];
      const body = chapterBody(text, chapter);
      if (!body.trim()) return;
      const chapterStart = bodyStartOffset(chapter.start, chapter.end, body.length);
      const hostStyle = getComputedStyle(host);
      const innerWidth =
        host.clientWidth -
        (parseFloat(hostStyle.paddingLeft) || 0) -
        (parseFloat(hostStyle.paddingRight) || 0);
      const maxImageHeight = Math.max(80, height - 40);
      host.replaceChildren();
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const paragraph of body.split('\n')) {
        if (paragraph.includes(IMAGE_PLACEHOLDER)) {
          // 图片按原始比例、一屏封顶占位；和正文里 CSS 的算法保持一致
          const image = imagesByOffset.get(chapterStart + offset);
          const box = document.createElement('div');
          if (image && image.width > 0 && image.height > 0) {
            const scaled = Math.min(innerWidth * (image.height / image.width), maxImageHeight);
            box.style.height = scaled + 'px';
          }
          box.style.margin = '12px 0';
          fragment.appendChild(box);
        } else {
          const element = document.createElement('p');
          element.textContent = paragraph;
          fragment.appendChild(element);
        }
        offset += paragraph.length + 1;
      }
      host.appendChild(fragment);
      void host.offsetHeight;
      const hostTop = host.getBoundingClientRect().top;
      const lines: Array<{ top: number; bottom: number }> = [];
      for (const child of Array.from(host.children)) {
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const rect of Array.from(range.getClientRects())) {
          lines.push({ top: rect.top - hostTop, bottom: rect.bottom - hostTop });
        }
      }
      if (lines.length === 0) return;
      const contentHeight = lines.reduce((max, line) => Math.max(max, line.bottom), 0) + 24;
      counts[chapterIndex] = buildPageOrigins(lines, height, contentHeight).length;
    };

    const tick = () => {
      if (token !== bookMeasureToken.current) {
        host.remove();
        return;
      }
      const deadline = performance.now() + 12;
      while (index < chapters.length && performance.now() < deadline) {
        measureOne(index);
        index += 1;
      }
      if (index < chapters.length) {
        window.setTimeout(tick, 0);
        return;
      }
      host.remove();
      bookStatsRef.current = { counts, total: totalPages(counts) };
      bookRunningRef.current = false;
      setBookStatsVersion((value) => value + 1);
    };
    window.setTimeout(tick, 0);
  }, [
    boss.boss,
    chapters,
    imagesByOffset,
    pageHeight,
    prefs.fontFamily,
    prefs.fontSize,
    prefs.fontWeight,
    prefs.lineHeight,
    prefs.paragraphSpacing,
    text,
  ]);

  useEffect(() => {
    measureBookPagesRef.current = measureBookPages;
  }, [measureBookPages]);

  useEffect(() => {
    return () => {
      bookMeasureToken.current += 1;
    };
  }, []);

  /** 统一入口：等渲染稳定后再量，过期任务直接丢弃。 */
  const scheduleLayout = useCallback(() => {
    const token = ++layoutToken.current;
    const run = () => {
      if (token !== layoutToken.current) return;
      layout();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(run));
    } else {
      window.setTimeout(run, 32);
    }
  }, [layout]);

  // 打开书籍：解析存档偏移，决定落在哪一章
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await window.reader.progress.get(book.id);
      if (cancelled) return;
      const offset = resolveSavedOffset(saved?.position, chapters, textLength);
      let index = chapterIndexAt(offset, chapters);
      let anchor = offset;
      // 落点是空章节（EPUB 封面/图片页）时顺延到有正文的章节，否则一打开就是空白页
      if (chapters[index] && !chapterHasBody(text, chapters[index])) {
        const next = nearestChapterWithBody(text, chapters, index, 1);
        const prev = next >= 0 ? -1 : nearestChapterWithBody(text, chapters, index, -1);
        const target = next >= 0 ? next : prev;
        if (target >= 0) {
          index = target;
          anchor = chapters[target].start;
        }
      }
      pendingOffset.current = anchor;
      chapterRef.current = index;
      pageRef.current = 0;
      setChapterIndex(index);
      setPercent(offsetToPercent(anchor, textLength));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [book.id, chapters, text, textLength]);

  // 章节、排版、老板模式变化后重新分页
  useEffect(() => {
    if (!ready) return;
    scheduleLayout();
  }, [ready, chapterIndex, scheduleLayout, prefs.fontSize, prefs.lineHeight, prefs.pageWidth, prefs.fontFamily, boss.boss, showToc]);

  // 老板模式切换会突变窗口尺寸：等布局稳定后按「当前字符偏移」重新分页，
  // 否则会用旧尺寸算出的页首，出现空白页或跳段
  useEffect(() => {
    if (!ready) return;
    pendingOffset.current = bodyStart + (pageStarts[page] ?? 0);
    pageRef.current = 0;
    const timer = window.setTimeout(() => scheduleLayout(), 260);
    return () => window.clearTimeout(timer);
    // 只在老板模式切换时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boss.boss]);

  // 窗口尺寸变化（含进入老板模式）后重排
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    let timer: number | null = null;
    const observer = new ResizeObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => scheduleLayout(), 120);
    });
    observer.observe(viewport);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [scheduleLayout]);

  // 页码变化时把取景框移到该页的页首（页首已吸附到行边界），框高裁到该页的行高
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const tops = pageTopsRef.current.length > 0 ? pageTopsRef.current : [0];
    const spans = pageSpansRef.current;
    const index = Math.min(Math.max(0, page), tops.length - 1);
    if (spans[index] !== undefined) frame.style.height = `${spans[index]}px`;
    frame.scrollTop = tops[index] ?? 0;
  }, [page, pageCount, pageHeight]);

  const persist = useCallback(
    (offset: number) => {
      const pct = offsetToPercent(offset, textLength);
      setPercent(pct);
      void window.reader.progress.set({
        bookId: book.id,
        position: { offset },
        percent: pct,
        updatedAt: Date.now(),
      });
    },
    [book.id, textLength],
  );

  // 页码稳定后立刻更新百分比（不能等到落盘，否则界面会滞后一拍）
  useEffect(() => {
    if (!ready) return;
    setPercent(offsetToPercent(bodyStart + (pageStarts[page] ?? 0), textLength));
  }, [bodyStart, page, pageStarts, ready, textLength]);

  // 页码稳定后再落盘，避免翻页时频繁写文件
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      persist(bodyStart + (pageStarts[page] ?? 0));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [bodyStart, page, pageStarts, persist, ready]);

  useEffect(() => {
    return () => {
      const offset = bodyStart + (pageStarts[pageRef.current] ?? 0);
      void window.reader.progress.set({
        bookId: book.id,
        position: { offset },
        percent: offsetToPercent(offset, textLength),
        updatedAt: Date.now(),
      });
    };
  }, [book.id, bodyStart, pageStarts, textLength]);

  const goToChapter = useCallback(
    (index: number, offset?: number) => {
      let target = Math.max(0, Math.min(total - 1, index));
      let anchor = offset;
      // 目录点到空章节时，跳到最近的、有正文的章节，不能点了没反应
      if (chapters[target] && !chapterHasBody(text, chapters[target])) {
        const next = nearestChapterWithBody(text, chapters, target, 1);
        const prev = next >= 0 ? -1 : nearestChapterWithBody(text, chapters, target, -1);
        const found = next >= 0 ? next : prev;
        if (found >= 0) target = found;
        anchor = undefined;
      }
      const chapter = chapters[target];
      const targetOffset = anchor ?? chapter.start;
      // 同一章内跳转（书签、搜索结果）：章号没变，重新分页不会触发，
      // 直接用现有的页首表换页，否则点了没反应
      if (target === chapterRef.current && pageStartsRef.current.length > 0) {
        const body = chapterBody(text, chapter);
        const start = bodyStartOffset(chapter.start, chapter.end, body.length);
        const starts = pageStartsRef.current;
        const next = pageIndexForOffset(starts, relativeOffset(targetOffset, start));
        const clamped = Math.max(0, Math.min(next, starts.length - 1));
        pendingOffset.current = null;
        pageRef.current = clamped;
        setPage(clamped);
        return;
      }
      pendingOffset.current = targetOffset;
      chapterRef.current = target;
      pageRef.current = 0;
      setChapterIndex(target);
    },
    [chapters, text, total],
  );

  const jumpToOffset = useCallback(
    (offset: number) => {
      goToChapter(chapterIndexAt(offset, chapters), offset);
    },
    [chapters, goToChapter],
  );

  const currentOffset = bodyStart + (pageStarts[page] ?? 0);

  const addBookmark = useCallback(async () => {
    const created = await window.reader.bookmarks.add({
      bookId: book.id,
      offset: currentOffset,
      chapterTitle: current?.title ?? '',
      excerpt: makeExcerpt(text, currentOffset),
    });
    setBookmarks((list) =>
      [...list.filter((item) => item.id !== created.id), created].sort((a, b) => a.offset - b.offset),
    );
  }, [book.id, current, currentOffset, text]);

  const removeBookmark = useCallback(
    async (id: string) => {
      await window.reader.bookmarks.remove(book.id, id);
      setBookmarks((list) => list.filter((item) => item.id !== id));
    },
    [book.id],
  );

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

  /** 记录阅读时长：每 15 秒累计一次，离开时落一笔。 */
  useEffect(() => {
    const startedAt = Date.now();
    let lastTick = startedAt;
    let seconds = 0;

    const tick = () => {
      const now = Date.now();
      const delta = Math.round((now - lastTick) / 1000);
      lastTick = now;
      // 超过两分钟的间隔按「挂着没看」处理，不计入
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

  // 背景图读成 data URL（file:// 在开发态 http 页面下会被拦截）
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

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setMatches([]);
  }, []);

  const jumpToMatch = useCallback(
    (match: SearchMatch) => {
      setHighlight({ from: match.offset, to: match.offset + match.match.length });
      jumpToOffset(match.offset);
      closeSearch();
      window.setTimeout(() => setHighlight(null), 2400);
    },
    [jumpToOffset],
  );

  const nextPage = useCallback(() => {
    if (page < pageCount - 1) {
      pageRef.current = page + 1;
      setPage(page + 1);
      return;
    }
    // 跳过空章节，直接进入下一个有正文的章节
    const next = nearestChapterWithBody(text, chapters, chapterIndex, 1);
    if (next >= 0) goToChapter(next);
  }, [chapterIndex, chapters, goToChapter, page, pageCount, text]);

  const prevPage = useCallback(() => {
    if (page > 0) {
      pageRef.current = page - 1;
      setPage(page - 1);
      return;
    }
    const prev = nearestChapterWithBody(text, chapters, chapterIndex, -1);
    if (prev >= 0) {
      const previous = chapters[prev];
      // 跳到上一章的最后一页：用该章末尾的偏移恢复
      pendingOffset.current = Math.max(previous.start, previous.end - 1);
      chapterRef.current = prev;
      pageRef.current = 0;
      setChapterIndex(prev);
    }
  }, [chapterIndex, chapters, page, text]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.ctrlKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      // Esc 必须在「输入框」判断之前处理，否则焦点在搜索框里时会被吞掉
      if (event.key === 'Escape') {
        if (searchOpen) closeSearch();
        else if (showSettings) setShowSettings(false);
        else if (boss.boss) onToggleBoss(false);
        else if (showToc) setShowToc(false);
        else onBack();
        return;
      }
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        nextPage();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        prevPage();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [boss.boss, closeSearch, nextPage, onBack, onToggleBoss, prevPage, searchOpen, showSettings, showToc]);

  // 搜索输入变化即搜
  useEffect(() => {
    if (!searchOpen) return;
    setMatches(query.trim() ? searchText(text, query, chapters, { limit: 60 }) : []);
  }, [chapters, query, searchOpen, text]);

  // 上下留白放在取景框外：既保住留白，又让分页只按「真正能放字的高度」算
  const viewportStyle: React.CSSProperties = {
    paddingTop: `${prefs.pageMargin}px`,
    paddingBottom: `${prefs.pageMargin}px`,
  };

  const bookStats = bookStatsRef.current;
  const footerCounts = bookStats ? bookStats.counts.slice() : [];
  if (bookStats && footerCounts.length > chapterIndex) footerCounts[chapterIndex] = pageCount;
  const bookPage = bookStats ? pageOffset(footerCounts, chapterIndex) + page + 1 : 0;
  const footerStatus = bookStats
    ? `全书 ${bookPage} / ${bookStats.total} 页 · 本章 ${page + 1} / ${pageCount} · 第 ${chapterIndex + 1} / ${total} 章 · ${formatPercent(percent)}`
    : `本章 ${page + 1} / ${pageCount} · 第 ${chapterIndex + 1} / ${total} 章 · ${formatPercent(percent)}`;

  const bodyStyle = {
    fontSize: `${boss.boss ? Math.max(13, Math.round(prefs.fontSize * 0.8)) : prefs.fontSize}px`,
    lineHeight: prefs.lineHeight,
    fontFamily:
      prefs.fontFamily === 'serif'
        ? 'var(--font-serif)'
        : prefs.fontFamily === 'deng'
          ? 'var(--font-deng)'
          : 'var(--font-sans)',
    fontWeight: prefs.fontWeight === 'bold' ? 700 : prefs.fontWeight === 'medium' ? 500 : 400,
    ['--para-gap' as string]: `${prefs.paragraphSpacing}em`,
  } as React.CSSProperties;

  // 版心约束放在分页容器上：栏宽必须等于版心，否则下一列会从右边漏出来
  // 版心自适应：取「设置值」与「窗口宽度减去两侧留白」的较小者
  const frameStyle = {
    maxWidth: boss.boss ? 'none' : `min(${prefs.pageWidth}px, calc(100% - 80px))`,
  };

  const highlightRange = highlight
    ? { from: relativeOffset(highlight.from, bodyStart), to: relativeOffset(highlight.to, bodyStart) }
    : null;

  /** 命中位置高亮：把命中的那一段包进 <mark>。 */
  /** 一张书内图片：占位框按原始宽高比撑开，加载完成后图片填满它。 */
  const renderBookImage = (image: BookImage) => {
    const url = imageUrls[image.file];
    return (
      <figure className="book-image" key={`img-${image.offset}`}>
        <span
          className="book-image-frame"
          style={{
            ['--img-w' as string]: image.width,
            ['--img-h' as string]: image.height,
            aspectRatio: `${image.width} / ${image.height}`,
          }}
        >
          {url ? <img src={url} alt="" draggable={false} /> : null}
        </span>
      </figure>
    );
  };

  const renderParagraph = (paragraph: string, index: number) => {
    if (paragraph.includes(IMAGE_PLACEHOLDER)) {
      // 图片偏移是全书的绝对偏移，段落偏移要加上本章正文起点
      const baseOffset = bodyStart + offsetAtNode(paragraphs, index, 0);
      const parts = paragraph.split(IMAGE_PLACEHOLDER);
      const nodes: React.ReactNode[] = [];
      let offset = baseOffset;
      parts.forEach((piece, pieceIndex) => {
        if (pieceIndex > 0) {
          const image = imagesByOffset.get(offset);
          nodes.push(image ? renderBookImage(image) : <span key={`ph-${pieceIndex}`}>[图片]</span>);
          offset += 1;
        }
        if (piece) {
          nodes.push(<span key={`t-${pieceIndex}`}>{piece}</span>);
          offset += piece.length;
        }
      });
      return nodes;
    }
    if (!highlightRange) return paragraph;
    const start = offsetAtNode(paragraphs, index, 0);
    const end = start + paragraph.length;
    if (highlightRange.to <= start || highlightRange.from >= end) return paragraph;
    const from = Math.max(0, highlightRange.from - start);
    const to = Math.min(paragraph.length, highlightRange.to - start);
    return (
      <>
        {paragraph.slice(0, from)}
        <mark className="hit">{paragraph.slice(from, to)}</mark>
        {paragraph.slice(to)}
      </>
    );
  };
  return (
    <>
      {bgUrl && (
        <div
          className="page-bg"
          style={{ backgroundImage: `url("${bgUrl}")`, opacity: prefs.backgroundOpacity }}
        />
      )}
    <div className={boss.boss ? 'reader boss' : 'reader'} data-testid="reader">
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
            <span>{current?.title ?? ''}</span>
          </div>
          <div className="reader-actions">
            <button type="button" className="ghost" onClick={() => onToggleBoss(true)}>
              老板模式
            </button>
            <button
              type="button"
              className={showToc ? 'ghost active' : 'ghost'}
              onClick={() => setShowToc((value) => !value)}
            >
              目录
            </button>
            <button type="button" className="ghost" onClick={() => setSearchOpen(true)}>
              搜索
            </button>
            <button type="button" className="ghost" onClick={() => void addBookmark()}>
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
        {!boss.boss && showToc && (
          <aside className="toc" data-testid="toc">
            {bookmarks.length > 0 && (
              <div className="mark-block">
                <div className="mark-title">书签</div>
                {bookmarks.map((mark) => (
                  <div key={mark.id} className="mark-row">
                    <button
                      type="button"
                      className="mark-jump"
                      onClick={() => jumpToOffset(mark.offset)}
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
                ))}
              </div>
            )}

            {chapters.map((chapter) => (
              <button
                type="button"
                key={chapter.index}
                className={chapter.index === chapterIndex ? 'toc-item active' : 'toc-item'}
                onClick={() => goToChapter(chapter.index)}
              >
                <span className="toc-no">{chapter.index + 1}</span>
                <span className="toc-name">{chapter.title}</span>
              </button>
            ))}

          </aside>
        )}

        <div
          className="page-viewport"
          ref={viewportRef}
          style={viewportStyle}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            // 上半区上一页、下半区下一页
            if (event.clientY - rect.top < rect.height / 2) prevPage();
            else nextPage();
          }}
          onWheel={(event) => {
            // 滚轮翻页：累积一点才触发，避免触控板一次滑动连翻
            const now = Date.now();
            if (now - wheelAt.current < 220) return;
            if (Math.abs(event.deltaY) < 4) return;
            wheelAt.current = now;
            if (event.deltaY < 0) prevPage();
            else nextPage();
          }}
        >
          <div className="page-frame" ref={frameRef} style={frameStyle}>
          <div className="page-columns" ref={columnsRef}>
            {paragraphs.map((paragraph, index) => (
              <p
                key={index}
                style={bodyStyle}
                className={paragraph.includes(IMAGE_PLACEHOLDER) ? 'image-paragraph' : undefined}
              >
                {renderParagraph(paragraph, index)}
              </p>
            ))}
          </div>
          </div>
        </div>

        {searchOpen && (
          <div className="overlay open" onClick={closeSearch}>
            <div className="search-box" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="search-close" onClick={closeSearch} title="关闭搜索">
                ×
              </button>
              <input
                autoFocus
                className="search-input"
                value={query}
                placeholder="搜索本书内容…（Esc 关闭）"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="search-list">
                {query.trim() === '' ? (
                  <p className="search-empty">输入关键词开始搜索</p>
                ) : matches.length === 0 ? (
                  <p className="search-empty">没有找到「{query}」</p>
                ) : (
                  matches.map((match) => (
                    <button
                      type="button"
                      key={`${match.offset}-${match.match}`}
                      className="search-hit"
                      onClick={() => jumpToMatch(match)}
                    >
                      <span className="search-where">
                        {chapters[match.chapterIndex]?.title ?? ''}
                      </span>
                      <span className="search-context">
                        {match.before}
                        <mark>{match.match}</mark>
                        {match.after}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

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
          <button type="button" className="ghost" onClick={prevPage}>
            ← 上一页
          </button>
          <span className="reader-status">{footerStatus}</span>
          <button type="button" className="ghost" onClick={nextPage}>
            下一页 →
          </button>
        </footer>
      )}
    </div>
    </>
  );
}
