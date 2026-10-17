import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { BossState } from '../shared/api';
import type { Book, BookContent, Prefs, ShelfItem } from '../shared/types';
import { DEFAULT_PREFS } from '../core/prefs';
import { Shelf } from './components/Shelf';
import { Reader } from './components/Reader';
import { PdfReader } from './components/PdfReader';

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export default function App() {
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [content, setContent] = useState<BookContent | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boss, setBoss] = useState<BossState>({ boss: false, opacity: 0.55, hotkey: 'E' });
  const dragDepth = useRef(0);

  const refresh = useCallback(async () => {
    setItems(await window.reader.library.list());
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await window.reader.prefs.get();
        setPrefs(loaded);
        await refresh();
      } catch (err) {
        setError(describeError(err));
      }
    })();
  }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs.theme]);

  // 老板模式状态由主进程掌控（全局热键也能触发），这里只订阅
  useEffect(() => {
    let alive = true;
    void window.reader.window
      .getState()
      .then((state) => {
        if (alive) setBoss(state);
      })
      .catch(() => undefined);
    const off = window.reader.window.onBossChanged((state) => setBoss(state));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const toggleBoss = useCallback(async (on?: boolean) => {
    try {
      await window.reader.window.toggleBoss(on);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  // 单键热键（不带 +）只在本窗口内生效，避免抢占系统里所有输入框
  useEffect(() => {
    const accelerator = boss.hotkey;
    if (!accelerator || accelerator.includes('+')) return;
    const handler = (event: KeyboardEvent) => {
      // 正在录制热键时不要响应，否则按下的键会被当成老板模式开关
      if (document.querySelector('.hotkey-key.capturing')) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      if (key !== accelerator) return;
      event.preventDefault();
      void window.reader.window.toggleBoss();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [boss.hotkey]);

  const openBook = useCallback(async (id: string) => {
    try {
      setContent(await window.reader.library.open(id));
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  const importViaDialog = useCallback(async () => {
    try {
      const books = await window.reader.library.importViaDialog();
      if (books.length === 0) return;
      await refresh();
      if (books.length === 1) await openBook(books[0].id);
    } catch (err) {
      setError(describeError(err));
    }
  }, [openBook, refresh]);

  const removeBook = useCallback(
    async (id: string) => {
      const book = items.find((item) => item.book.id === id)?.book;
      const confirmed = window.confirm(`确定从书架删除《${book?.title ?? '这本书'}》吗？\n本地正文副本也会一并删除。`);
      if (!confirmed) return;
      try {
        await window.reader.library.remove(id);
        await refresh();
      } catch (err) {
        setError(describeError(err));
      }
    },
    [items, refresh],
  );

  const updatePrefs = useCallback(async (patch: Partial<Prefs>) => {
    setPrefs((current) => ({ ...current, ...patch }));
    try {
      const saved = await window.reader.prefs.set(patch);
      setPrefs(saved);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    if (event.dataTransfer.types.includes('Files')) setDragging(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);

      const files = Array.from(event.dataTransfer.files).filter((file) =>
        /\.(txt|epub|pdf)$/i.test(file.name),
      );
      if (files.length === 0) {
        setError('只支持 .epub、.txt 与 .pdf 文件');
        return;
      }

      try {
        const imported: Book[] = [];
        for (const file of files) {
          const buffer = await file.arrayBuffer();
          imported.push(await window.reader.library.importBytes(file.name, buffer));
        }
        await refresh();
        if (imported.length === 1) await openBook(imported[0].id);
      } catch (err) {
        setError(describeError(err));
      }
    },
    [openBook, refresh],
  );

  if (content) {
    // PDF 按页渲染（一页一屏），TXT/EPUB 走字符分页；两者共用同一套书架与老板模式状态
    const Viewer = content.book.format === 'pdf' ? PdfReader : Reader;
    return (
      <Viewer
        content={content}
        prefs={prefs}
        boss={boss}
        onPrefsChange={updatePrefs}
        onToggleBoss={toggleBoss}
        onBack={() => {
          if (boss.boss) void toggleBoss(false);
          setContent(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div
      className="app"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDrop(event)}
    >
      <Shelf items={items} onOpen={openBook} onRemove={removeBook} onImport={importViaDialog} />
      {dragging && <div className="drop-overlay">松手即可导入</div>}
      {error && (
        <button type="button" className="toast" onClick={() => setError(null)}>
          {error}
        </button>
      )}
    </div>
  );
}
