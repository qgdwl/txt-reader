/**
 * 阅读统计：只做「记录每次阅读时长 → 按天汇总」。
 * 不记书名、不记内容，纯本地数字。
 */

export interface ReadingSession {
  bookId: string;
  /** 本次阅读开始的毫秒时间戳。 */
  startedAt: number;
  /** 本次阅读的累计秒数。 */
  seconds: number;
}

export interface DailyBucket {
  /** 本地日期 YYYY-MM-DD。 */
  date: string;
  seconds: number;
}

export interface StatsSummary {
  todaySeconds: number;
  totalSeconds: number;
  /** 有阅读记录的天数。 */
  activeDays: number;
  /** 最近 N 天，按时间正序，最后一个是今天。 */
  lastDays: DailyBucket[];
  sessionCount: number;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 本地时区的日期键（跨天按用户所在时区算）。 */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 把一次阅读记录折算到它开始的那一天。 */
function bucketKey(session: ReadingSession): string {
  return dayKey(session.startedAt);
}

export function summarize(
  sessions: readonly ReadingSession[],
  now: number,
  windowDays = 7,
): StatsSummary {
  const valid = sessions.filter(
    (session) => Number.isFinite(session.seconds) && session.seconds > 0 && Number.isFinite(session.startedAt),
  );

  const perDay = new Map<string, number>();
  let totalSeconds = 0;
  for (const session of valid) {
    const key = bucketKey(session);
    perDay.set(key, (perDay.get(key) ?? 0) + session.seconds);
    totalSeconds += session.seconds;
  }

  const today = dayKey(now);
  const days = Math.max(1, Math.round(windowDays));
  const lastDays: DailyBucket[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const dayStart = startOfDay(now) - index * 86400000;
    const key = dayKey(dayStart);
    lastDays.push({ date: key, seconds: Math.round(perDay.get(key) ?? 0) });
  }

  return {
    todaySeconds: Math.round(perDay.get(today) ?? 0),
    totalSeconds: Math.round(totalSeconds),
    activeDays: perDay.size,
    lastDays,
    sessionCount: valid.length,
  };
}

/** 把秒数渲染成人话：不足 1 分钟也显示。 */
export function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value} 秒`;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

/** 平均阅读速度：字/分钟。没有时长时返回 0。 */
export function charsPerMinute(chars: number, seconds: number): number {
  if (!Number.isFinite(chars) || !Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round((chars / seconds) * 60);
}
