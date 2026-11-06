/**
 * How the screens print timestamps, template names and lists. Kept apart from the view models so
 * each rule is written once and tested at its edges.
 */

function parts(ts: string, opts: Intl.DateTimeFormatOptions, timeZone = 'UTC') {
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    ...opts,
    timeZone,
    hourCycle: 'h23',
  }).formatToParts(new Date(ts))) {
    map[p.type] = p.value;
  }
  return map;
}

/** "25 Oct 2026, 02:34 UTC". */
export function dateTimeUtc(ts: string): string {
  const p = parts(ts, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} UTC`;
}

/** "26 Oct, 02:34 UTC". */
export function dayTimeUtc(ts: string): string {
  const p = parts(ts, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} UTC`;
}

/** "25 Oct 2026 at 02:33 UTC": when the crawler tests ran (the segment pages). */
export function testedAt(ts: string): string {
  const p = parts(ts, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${p.day} ${p.month} ${p.year} at ${p.hour}:${p.minute} UTC`;
}

/** "02:33:07 UTC": when one response came back. */
export function timeOfDay(ts: string): string {
  const p = parts(ts, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${p.hour}:${p.minute}:${p.second} UTC`;
}

/** "Fri 06:02", in the given zone: how the account's own clock reads it. */
export function weekdayTime(ts: string, timeZone: string): string {
  const p = parts(ts, { weekday: 'short', hour: '2-digit', minute: '2-digit' }, timeZone);
  return `${p.weekday} ${p.hour}:${p.minute}`;
}

/** "Thu", in the given zone. */
export function weekday(ts: string, timeZone: string): string {
  return parts(ts, { weekday: 'short' }, timeZone).weekday!;
}

/** "Thursday", in the given zone: "Since Thursday's check". */
export function weekdayLong(ts: string, timeZone: string): string {
  return parts(ts, { weekday: 'long' }, timeZone).weekday!;
}

/** "Sat 24 Oct", in the given zone. */
export function dayDate(ts: string, timeZone: string): string {
  const p = parts(ts, { weekday: 'short', day: 'numeric', month: 'short' }, timeZone);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "24 Oct", in the given zone. */
export function dayMonth(ts: string, timeZone: string): string {
  const p = parts(ts, { day: 'numeric', month: 'short' }, timeZone);
  return `${p.day} ${p.month}`;
}

/** "24", in the given zone: a chart axis after its first label. */
export function dayOfMonth(ts: string, timeZone: string): string {
  return parts(ts, { day: 'numeric' }, timeZone).day!;
}

/** "06:02", in the given zone. */
export function hourMinute(ts: string, timeZone: string): string {
  const p = parts(ts, { hour: '2-digit', minute: '2-digit' }, timeZone);
  return `${p.hour}:${p.minute}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date an instant falls on in the zone, as midnight UTC of that date. */
function localDate(ts: string, timeZone: string): number {
  const p = parts(ts, { year: 'numeric', month: '2-digit', day: '2-digit' }, timeZone);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
}

/** How many dates apart two instants are on the zone's calendar; negative when `to` is earlier. */
export function calendarDays(from: string, to: string, timeZone: string): number {
  return Math.round((localDate(to, timeZone) - localDate(from, timeZone)) / DAY_MS);
}

/** Whether two instants fall on the same date in the zone ("last check today 06:02"). */
export const sameDay = (a: string, b: string, timeZone: string) =>
  calendarDays(a, b, timeZone) === 0;

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(t: number, timeZone: string): number {
  const p = parts(
    new Date(t).toISOString(),
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    },
    timeZone,
  );
  const wall = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return wall - Math.floor(t / 1000) * 1000;
}

/**
 * The instant at which the zone's clock reads `hour`:00 on a date (given as midnight UTC of that
 * date). The offset is read a second time at the first guess, so an hour on the far side of a
 * change of offset lands on the right instant.
 */
function atLocalHour(date: number, hour: number, timeZone: string): number {
  return atLocalTime(date, hour * 60 * 60 * 1000, timeZone);
}

/** The instant the zone's clock reads `ms` past midnight on a date given as midnight UTC. */
function atLocalTime(date: number, ms: number, timeZone: string): number {
  const wall = date + ms;
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

/**
 * The same clock time `days` calendar days earlier in the zone: "three days before the trial ends"
 * as the account reads it, which differs from 72 hours across a change of offset.
 */
export function daysBefore(ts: string, days: number, timeZone: string): string {
  const t = Date.parse(ts);
  const date = localDate(ts, timeZone);
  const clock = t + offsetAt(t, timeZone) - date;
  return new Date(atLocalTime(date - days * DAY_MS, clock, timeZone)).toISOString();
}

/**
 * The next weekly check after `now`: the first instant strictly after it at which the zone's clock
 * reads the schedule's ISO weekday (1 Monday … 7 Sunday) and hour.
 */
export function nextWeekly(
  schedule: { iso_weekday: number; hour_local: number },
  now: string,
  timeZone: string,
): string {
  const today = localDate(now, timeZone);
  for (let i = 0; i <= 7; i++) {
    const date = today + i * DAY_MS;
    if ((new Date(date).getUTCDay() || 7) !== schedule.iso_weekday) continue;
    const at = atLocalHour(date, schedule.hour_local, timeZone);
    if (at > Date.parse(now)) return new Date(at).toISOString();
  }
  throw new Error(`No weekly check within eight days of ${now}`);
}

/** "Indianapolis time", or "UTC": the zone named for a reader, from its IANA name. */
export function zoneName(timeZone: string): string {
  if (timeZone === 'UTC') return 'UTC';
  return `${timeZone.split('/').at(-1)!.replace(/_/g, ' ')} time`;
}

/** "2 min 11 s", "54 s". */
export function duration(ms: number): string {
  // Whole seconds elapsed, as the crawl screen's clock counts them, so the two never disagree.
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

/** "0:47": the crawl screen's elapsed clock. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const LIST = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

/** "a", "a and b", "a, b and c": British usage, no comma before "and", as the locked copy writes. */
export function listOf(items: readonly string[]): string {
  return LIST.format(items);
}

/** A share as a whole percentage, as the screens print it. */
export const percent = (share: number) => Math.round(share * 100);

/**
 * How each template is named in a sentence, by its label. A template not listed here is an error,
 * so a new fixture cannot be described with a guessed noun; format.test.ts checks every fixture's
 * templates are listed.
 */
export const TEMPLATE_NOUNS: Record<string, { inList: string; adjective: string; pages: string }> =
  {
    Homepage: { inList: 'homepage', adjective: 'home', pages: 'the homepage' },
    Collections: { inList: 'collections', adjective: 'collection', pages: 'collection pages' },
    Products: { inList: 'products', adjective: 'product', pages: 'product pages' },
    Blog: { inList: 'blog', adjective: 'blog', pages: 'blog posts' },
    Journal: { inList: 'journal', adjective: 'journal', pages: 'journal posts' },
    Guides: { inList: 'guides', adjective: 'guide', pages: 'guides' },
    Services: { inList: 'services', adjective: 'service', pages: 'service pages' },
    Aircraft: { inList: 'aircraft', adjective: 'aircraft', pages: 'aircraft pages' },
    News: { inList: 'news', adjective: 'news', pages: 'news posts' },
    Vehicles: { inList: 'vehicles', adjective: 'vehicle', pages: 'vehicle pages' },
    Work: { inList: 'work', adjective: 'work', pages: 'work pages' },
  };

export function templateNoun(label: string) {
  if (!Object.hasOwn(TEMPLATE_NOUNS, label)) throw new Error(`No noun for template "${label}"`);
  return TEMPLATE_NOUNS[label]!;
}
