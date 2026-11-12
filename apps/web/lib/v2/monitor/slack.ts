/**
 * The Slack side of an alert (CC-28 D5): the message, built by us as plain text, and the POST to the
 * account's incoming-webhook URL.
 *
 * The URL is a member's input, so it is held to the form CC-27b stored it under (`SLACK_WEBHOOK`, the
 * same pattern as `lib/v2/account/alert-rules.ts`), its host must be exactly `hooks.slack.com`, and the
 * engine's SSRF guard (`validateUrlOrThrow`, the check `safeFetch` makes on every hop) must pass it
 * before the request; redirects are not followed. `safeFetch` itself only makes GET requests, so the
 * POST is `fetch` behind that guard (report-C.md, "Slack"). The URL is never logged, returned, or put
 * in an error or an event: every failure is answered as a fixed code. A lookup of Slack's host that
 * fails is `slack_dns`, retried; an address the guard refuses is `slack_url_refused`, not retried.
 */
import { promises as dns } from 'node:dns';
import { validateUrlOrThrow, type DnsResolver } from '@crawlmouse/engine';
import { dayDate, hourMinute } from '../format';
import { count, plural } from '../words';
import { oneLine } from '../mail/escape';
import {
  BOUNDS,
  capRows,
  pageUrl,
  problemsFirst,
  rowText,
  type MailChange,
} from '../mail/templates/alert';

/** Slack's incoming-webhook URL, as `set_account_slack_webhook` (migration 027b) holds it. */
export const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+$/;
export const SLACK_URL_MAX = 500;
export const SLACK_TIMEOUT_MS = 10_000;
/** The rows a Slack message lists before it says how many more there are. */
export const SLACK_ROWS_MAX = 10;

export type SlackResult = { ok: true } | { ok: false; code: string; retryable: boolean };
export type PostSlack = (url: string, text: string) => Promise<SlackResult>;

/** Slack reads `&`, `<` and `>` as markup in a message's text; these are its escapes. */
export function slackEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface SlackAlertInput {
  host: string;
  checkId: string;
  checkedAt: string;
  zone: string;
  changes: readonly MailChange[];
}

export function slackAlertText(input: SlackAlertInput): string {
  const host = slackEscape(oneLine(input.host, BOUNDS.host));
  const all = problemsFirst(input.changes);
  const { shown, more } = capRows(all, SLACK_ROWS_MAX);
  const when = `${dayDate(input.checkedAt, input.zone)} ${hourMinute(input.checkedAt, input.zone)}`;
  const rows = shown
    .map(rowText)
    .map((r) => `• ${r.label}: ${slackEscape(r.line)} (${slackEscape(r.detail)})`);
  return [
    `Crawlmouse: ${count(all.length)} ${plural(all.length, 'change', 'changes')} on ${host} at the check that finished ${when}`,
    ...rows,
    ...(more ? [`And ${count(more)} more.`] : []),
    `Open the check: ${pageUrl('/audit/', input.checkId)}`,
  ].join('\n');
}

/** A URL in the stored form, on Slack's webhook host and nowhere else. */
export function isSlackWebhook(url: string): boolean {
  if (url.length > SLACK_URL_MAX || !SLACK_WEBHOOK.test(url)) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'hooks.slack.com' &&
      u.port === '' &&
      u.search === ''
    );
  } catch {
    return false;
  }
}

/** A lookup of Slack's host that failed (no answer, a timeout, a resolver error): worth retrying. */
export class DnsUnavailable extends Error {
  constructor() {
    super('slack host lookup failed');
    this.name = 'DnsUnavailable';
  }
}

type Lookup = (host: string) => Promise<readonly { address: string }[]>;

/**
 * The SSRF guard's resolver for the Slack POST. The engine's default answers a failed lookup with no
 * address, which the guard refuses like a forbidden one; this one throws `DnsUnavailable` instead, so
 * the poster can tell a lookup that failed for the moment from an address the guard refuses.
 */
export function slackResolver(
  lookup: Lookup = (host) => dns.lookup(host, { all: true }),
): DnsResolver {
  return async (host) => {
    let records: readonly { address: string }[];
    try {
      records = await lookup(host);
    } catch {
      throw new DnsUnavailable();
    }
    if (records.length === 0) throw new DnsUnavailable();
    return records.map((r) => r.address);
  };
}

export interface SlackPostDeps {
  fetch: typeof fetch;
  /** The engine's SSRF check; throws for a URL it refuses. */
  validate: (url: string) => Promise<unknown>;
  timeoutMs?: number;
}

export function slackPoster(
  deps: SlackPostDeps = {
    fetch,
    validate: (url) => validateUrlOrThrow(url, { resolver: slackResolver() }),
  },
): PostSlack {
  return async (url, text) => {
    if (!isSlackWebhook(url)) return { ok: false, code: 'slack_url_refused', retryable: false };
    try {
      await deps.validate(url);
    } catch (e) {
      if (e instanceof DnsUnavailable) return { ok: false, code: 'slack_dns', retryable: true };
      return { ok: false, code: 'slack_url_refused', retryable: false };
    }
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
        redirect: 'manual',
        signal: AbortSignal.timeout(deps.timeoutMs ?? SLACK_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, code: 'network', retryable: true };
    }
    if (res.status >= 200 && res.status < 300) return { ok: true };
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, code: `slack_${res.status}`, retryable };
  };
}
