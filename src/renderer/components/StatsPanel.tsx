import type { StatsSummary } from '../../core/stats';
import { formatDuration } from '../../core/stats';

interface StatsPanelProps {
  summary: StatsSummary | null;
  onClose: () => void;
  onClear: () => void;
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

function weekdayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : WEEKDAY[parsed.getDay()];
}

export function StatsPanel({ summary, onClose, onClear }: StatsPanelProps) {
  const days = summary?.lastDays ?? [];
  const peak = Math.max(60, ...days.map((day) => day.seconds));
  const average = summary && summary.activeDays > 0
    ? Math.round(summary.totalSeconds / summary.activeDays)
    : 0;

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="stats-card" onClick={(event) => event.stopPropagation()}>
        <header className="stats-head">
          <h2>阅读统计</h2>
          <button type="button" className="ghost small" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="kpis">
          <div className="kpi">
            <div className="kpi-n">{formatDuration(summary?.todaySeconds ?? 0)}</div>
            <div className="kpi-l">今日</div>
          </div>
          <div className="kpi">
            <div className="kpi-n">{formatDuration(summary?.totalSeconds ?? 0)}</div>
            <div className="kpi-l">累计</div>
          </div>
          <div className="kpi">
            <div className="kpi-n">{summary?.activeDays ?? 0} 天</div>
            <div className="kpi-l">有阅读</div>
          </div>
          <div className="kpi">
            <div className="kpi-n">{formatDuration(average)}</div>
            <div className="kpi-l">日均</div>
          </div>
        </div>

        <div className="chart">
          {days.map((day) => (
            <div key={day.date} className="chart-col" title={`${day.date} · ${formatDuration(day.seconds)}`}>
              <div
                className="chart-bar"
                style={{ height: `${Math.max(2, Math.round((day.seconds / peak) * 100))}%` }}
              />
              <div className="chart-label">{weekdayOf(day.date)}</div>
            </div>
          ))}
        </div>
        <p className="hint">最近 7 天阅读时长</p>

        <footer className="stats-foot">
          <span className="hint">共 {summary?.sessionCount ?? 0} 次阅读</span>
          <button type="button" className="ghost small" onClick={onClear}>
            清空统计
          </button>
        </footer>
      </div>
    </div>
  );
}
