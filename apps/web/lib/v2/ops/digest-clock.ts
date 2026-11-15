/**
 * When the founder digest is due (CC-33 D3; plan-review m19), from an injected instant read on
 * America/New_York's wall clock through `Intl`, so a day is New York's: 23 or 25 hours on the days the
 * clocks change. From 08:00 New York onwards the daily digest for the day before is due, under one key
 * a day, so a tick that missed 08:00 sends it at the next one and the mail ledger stops a second; on a
 * Monday the weekly digest for the Monday-to-Sunday before is due the same way.
 */

export const DIGEST_ZONE = 'America/New_York';
export const DIGEST_HOUR = 8;

/** A window [from, to) as ISO instants. */
export interface Window {
  from: string;
  to: string;
}

export interface DailyDue extends Window {
  key: string;
  /** New York's date the window covers, YYYY-MM-DD. */
  date: string;
}

export interface WeeklyDue {
  key: string;
  /** The Monday the week starts on, YYYY-MM-DD. */
  monday: string;
  week: Window;
  /** The week before, for the change. */
  previous: Window;
}

export interface DigestDue {
  daily: DailyDue | null;
  weekly: WeeklyDue | null;
  /** The key the tick's "N more" notice takes the held notices under: its UTC hour. */
  overflowKey: string;
}

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: DIGEST_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

interface Wall {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
}

function wall(ms: number): Wall {
  const p = Object.fromEntries(PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: p.weekday!,
  };
}

/** How far New York's wall clock is from UTC at `ms`, in ms (negative: behind). */
function offset(ms: number): number {
  const w = wall(ms);
  return Date.UTC(w.y, w.m - 1, w.d, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant New York's date (y, m, d) begins. Midnight is never skipped or repeated there (the
 * clocks change at 02:00), so the offset read at the first guess, then at the instant it gives, is
 * the one in force at midnight.
 */
function midnight(y: number, m: number, d: number): number {
  const utc = Date.UTC(y, m - 1, d);
  const first = utc - offset(utc);
  return utc - offset(first);
}

/** The New York date `days` after (y, m, d), by the calendar. */
function addDays(y: number, m: number, d: number, days: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

const ymd = ([y, m, d]: [number, number, number]) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const iso = (ms: number) => new Date(ms).toISOString();

const windowOf = (start: [number, number, number], days: number): Window => ({
  from: iso(midnight(...start)),
  to: iso(midnight(...addDays(...start, days))),
});

export function digestDue(now: Date): DigestDue {
  const ms = now.getTime();
  const overflowKey = `overflow:${now.toISOString().slice(0, 13)}`;
  const w = wall(ms);
  if (w.hour < DIGEST_HOUR) return { daily: null, weekly: null, overflowKey };
  const today: [number, number, number] = [w.y, w.m, w.d];
  const yesterday = addDays(...today, -1);
  const daily: DailyDue = {
    key: `founder_digest:daily:${ymd(yesterday)}`,
    date: ymd(yesterday),
    ...windowOf(yesterday, 1),
  };
  if (w.weekday !== 'Mon') return { daily, weekly: null, overflowKey };
  const monday = addDays(...today, -7);
  return {
    daily,
    weekly: {
      key: `founder_digest:weekly:${ymd(monday)}`,
      monday: ymd(monday),
      week: windowOf(monday, 7),
      previous: windowOf(addDays(...monday, -7), 7),
    },
    overflowKey,
  };
}
