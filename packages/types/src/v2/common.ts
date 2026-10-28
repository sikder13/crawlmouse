/** Primitives shared by every v2 entity. */
import { z } from 'zod';
import { rules } from './rules.js';

export const IdSchema = z.uuid();
/** UTC instant, ISO 8601 with a trailing Z, at any fractional-second precision. */
export const TimestampSchema = z.iso.datetime();
export const DateSchema = z.iso.date();

/** Order two timestamps as instants. Comparing the strings misorders mixed precision (`:00Z` vs `:00.500Z`). */
export function instant(timestamp: string): number {
  return Date.parse(timestamp);
}

/**
 * An IANA time-zone name in Area/Location form, e.g. `America/Indiana/Indianapolis`, or `UTC` or
 * `Etc/*`. Single-word IANA links such as `EST` or `Japan` are not accepted, and neither is an offset
 * such as `+05:00`. The name must also be one this runtime's Intl data knows.
 * Runtimes with full ICU data (Node 22, current browsers) agree on the names in use; a runtime with
 * reduced ICU data could reject a zone another accepts.
 */
const IANA_SHAPE = /^(?:UTC|Etc\/[A-Za-z0-9+-]+|[A-Z][A-Za-z_-]+(?:\/[A-Za-z0-9_+-]+)+)$/;
export const TimeZoneSchema = z.string().check(
  rules((zone, rule) => {
    if (!IANA_SHAPE.test(zone) || !runtimeKnowsZone(zone)) rule.fail('time_zone');
  }),
);

function runtimeKnowsZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const HostSchema = z
  .string()
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
/**
 * An absolute http(s) URL. Shape only: it accepts private and loopback addresses, so it is not an
 * SSRF guard. Anything fetched from one of these goes through the engine's safe-fetch.
 */
export const HttpUrlSchema = z.url().regex(/^https?:\/\//);
/**
 * An https URL, for anything a user supplies that is shown on an https page or in an email. Shape
 * only, like HttpUrlSchema: it accepts `https://127.0.0.1/`, so anything fetched from one goes through
 * the engine's safe-fetch.
 */
export const HttpsUrlSchema = z.url().regex(/^https:\/\//);
export const EmailSchema = z.email();
/**
 * The page template a URL renders from, written as a path pattern: `/`, `/collections/{slug}`,
 * `/products/{slug}`. This is the grouping the screens use for their columns and the sample is
 * stratified by. It is NOT the v1 engine stratum key as-is: `templateKeyFor`
 * (packages/engine/src/analysis/template-key.ts) keeps short hyphen-free slugs literal, so it returns
 * `/collections/tents`, not `/collections/{slug}`. How the engine derives this key is open for the
 * engine stream.
 */
export const TemplateKeySchema = z.string().startsWith('/');
/** A stable fix identity across checks, so monitoring can match the same fix on a re-check. */
export const FingerprintSchema = z.string().regex(/^[0-9a-f]{16}$/);
/** A fraction in 0..1. */
export const ShareSchema = z.number().min(0).max(1);
export const ScoreSchema = z.number().min(0).max(100);
export const CountSchema = z.int().min(0);
export const HttpStatusSchema = z.int().min(100).max(599);
export const IsoWeekdaySchema = z.int().min(1).max(7);
export const SlackChannelSchema = z.string().regex(/^#[a-z0-9_-]+$/);

const encoder = new TextEncoder();
/**
 * A UTF-16 surrogate without its partner. It cannot be encoded as UTF-8, and one is enough to make the
 * insert that persists an audit fail (packages/engine/src/text-safety.ts), so crawled text with one is
 * rejected; the engine cuts text with `toPersistableText`, which never leaves one.
 * Written without lookbehind, which older Safari cannot parse, because the screens will bundle this;
 * a test in schemas.test.ts fails on a lookbehind anywhere in this package's source.
 */
const LONE_SURROGATE = /(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
const budgets = new WeakMap<object, number>();

/**
 * The byte budget of every schema `crawledText` created, so a test can find them all. Weakly held, so
 * a schema built at run time does not stay in memory because of it.
 */
export const CRAWLED_TEXT_BUDGETS: Pick<WeakMap<object, number>, 'has' | 'get'> = budgets;

/**
 * Text that came from a crawled site, bounded in UTF-8 BYTES, the unit the wire and the database
 * count (the project's text budgets are bytes; see packages/engine/src/text-safety.ts). The engine
 * cuts text to fit before it validates; this schema rejects anything that was not cut.
 */
export function crawledText(maxBytes: number, minLength = 0) {
  // A string's UTF-16 length never exceeds its UTF-8 byte length, so an over-long string is rejected
  // before it is encoded.
  const schema = z
    .string()
    .min(minLength)
    .check(
      rules((s, rule) => {
        if (s.length > maxBytes || encoder.encode(s).length > maxBytes) {
          rule.fail('crawled_text_budget');
          return; // an over-budget string is not scanned further
        }
        if (LONE_SURROGATE.test(s)) rule.fail('crawled_text_surrogate');
      }),
    );
  budgets.set(schema, maxBytes);
  return schema;
}

/** A response or request header, both sides bounded because both can come from a crawled site. */
export const HeaderSchema = z.strictObject({
  name: crawledText(128, 1),
  value: crawledText(1024),
});
export const MAX_HEADERS = 32;
