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

/** "Fri 06:02", in the given zone: how the account's own clock reads it. */
export function weekdayTime(ts: string, timeZone: string): string {
  const p = parts(ts, { weekday: 'short', hour: '2-digit', minute: '2-digit' }, timeZone);
  return `${p.weekday} ${p.hour}:${p.minute}`;
}

/** "2 min 11 s", "54 s". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

/** "0:47": the crawl screen's elapsed clock. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "a", "a and b", "a, b and c". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
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
