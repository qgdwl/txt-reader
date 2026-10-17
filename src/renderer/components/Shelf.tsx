import { useCallback, useEffect, useState } from 'react';
import type { ShelfItem } from '../../shared/types';
import type { StatsSummary } from '../../core/stats';
import { formatPercent } from '../../core/progress';
import { StatsPanel } from './StatsPanel';

interface ShelfProps {
  items: ShelfItem[];
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onImport: () => void;
}

const ENCODING_LABEL: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE',
  gb18030: 'GBK',
};

/** 书架上的格式与规模摘要：PDF 没有字数，显示总页数。 */
function describeBook(book: ShelfItem['book']): string {
  if (book.format === 'pdf') {
    return book.pageCount ? `PDF · ${book.pageCount.toLocaleString('zh-CN')} 页` : 'PDF · 页数待统计';
  }
  return `${book.format === 'epub' ? 'EPUB' : ENCODING_LABEL[book.encoding] ?? book.encoding} · ${book.charCount.toLocaleString('zh-CN')} 字`;
}

export function Shelf({ items, onOpen, onRemove, onImport }: ShelfProps) {
  const [statsOpen, setStatsOpen] = useState(false);
  const [summary, setSummary] = useState<StatsSummary | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setSummary(await window.reader.stats.summary(7));
    } catch {
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    if (statsOpen) void loadStats();
  }, [loadStats, statsOpen]);

  const clearStats = useCallback(async () => {
    await window.reader.stats.clear();
    await loadStats();
  }, [loadStats]);

  return (
    <div className="shelf" data-testid="shelf">
      <header className="shelf-header">
        <div>
          <h1>书架</h1>
          <p className="shelf-sub">{items.length > 0 ? `共 ${items.length} 本书` : '还没有书'}</p>
        </div>
        <div className="shelf-actions">
          <button type="button" className="ghost-btn" onClick={() => setStatsOpen(true)}>
            阅读统计
          </button>
          <button type="button" className="primary" onClick={onImport}>
            导入书籍
          </button>
        </div>
      </header>

      {statsOpen && (
        <StatsPanel
          summary={summary}
          onClose={() => setStatsOpen(false)}
          onClear={() => void clearStats()}
        />
      )}

      {items.length === 0 ? (
        <div className="empty">
          <p className="empty-title">书架还是空的</p>
          <p className="empty-hint">点右上角「导入书籍」，或把 .epub / .txt / .pdf 文件直接拖进窗口</p>
          <button type="button" className="primary" onClick={onImport}>
            选择文件
          </button>
        </div>
      ) : (
        <div className="book-grid">
          {items.map((item) => {
            const percent = item.progress?.percent ?? 0;
            const started = percent > 0;
            return (
              <article key={item.book.id} className="book-card">
                <div className="book-spine" aria-hidden="true">
                  {item.book.title.slice(0, 1)}
                </div>
                <div className="book-info">
                  <h2 title={item.book.title}>{item.book.title}</h2>
                  <p className="book-author">{item.book.author || '佚名'}</p>
                  <p className="book-meta">{describeBook(item.book)}</p>
                  <div className="book-progress">
                    <span style={{ width: `${percent * 100}%` }} />
                  </div>
                  <p className="book-percent">
                    {started ? `已读 ${formatPercent(percent)}` : '未开始'}
                  </p>
                </div>
                <div className="book-actions">
                  <button type="button" className="primary small" onClick={() => onOpen(item.book.id)}>
                    {started ? '继续阅读' : '开始阅读'}
                  </button>
                  <button type="button" className="ghost small" onClick={() => onRemove(item.book.id)}>
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
