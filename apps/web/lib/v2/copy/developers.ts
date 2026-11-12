/**
 * The words of the v2 Developers page (CC-29 D5), from Final-Developers with FACTS Part 2 applied:
 * A1 (`ai_readability`), A4 (the request line, the `cm_ro_` key and the roadmap rows unchanged but two,
 * J13 and K8) and B2 (the crawler rows' fields). The JSON example is not written here: it is built
 * from the fixture by `lib/v2/view/developers.ts`.
 *
 * Changes from the artboard, and why:
 * - The artboard says the read-only API exists today ("A read-only API today", "Available now, on
 *   Pro"). It does not: no route serves it and no key can be created. `developers.test.ts` holds
 *   what it can read of that: no route under a `v1` or `latest` path, no file under `app/` naming
 *   the key prefix, and no source or migration inserting an `api_keys` row. The heading, the intro and the sample's heading say it is coming, and the sample's card
 *   carries the "coming" mark.
 * - "unsubscribe in one click" is cut from the developer list's promise: the list has no unsubscribe
 *   link today.
 * - The roadmap's "Write API" and "MCP server" rows read "planned", not the artboard's "building"
 *   (owner ruling, rulings-3 Q37); the other rows keep the artboard's statuses. The roadmap's heading,
 *   the intro and the description say what follows the read API is planned, not being built.
 */

/** The read API's rate limit and key prefix (FACTS A4, DECISION J13); no plan gate holds them. */
export const READ_API = { requestsPerMinute: 60, keyPrefix: 'cm_ro_' } as const;

export const DEVELOPERS_COPY = {
  title: 'Developers',
  description:
    'A read-only API for your Crawlmouse audits is planned for Pro: the latest audit of each of your sites as JSON. See the response it will return, what comes after it, and join the developer list.',
  h1: 'A read-only API for your audits, then the audit as a tool your agent can call.',
  intro:
    'Pro accounts will create a read-only key and pull the latest audit of any of their sites as JSON: grades, the crawler table, fixes with packets, the link map as an edge list. That comes first. The write side — start an audit, mark a fix done, re-check — and an MCP server, a CLI and a GitHub check are planned after it, with no dates. This page says what exists now and what does not.',
  sample: {
    title: 'The read-only API, on Pro',
    coming: 'coming',
    /** `host` is the sample site's. */
    request: (host: string) =>
      `GET https://api.crawlmouse.com/v1/sites/${host}/latest\nAuthorization: Bearer ${READ_API.keyPrefix}…\n\n200 application/json`,
    /** What the sample leaves out, said from the data (OPERATING-RULES §10: no silent truncation). */
    shown: (p: { crawlersShown: string; crawlers: string; fixesShown: string; fixes: string }) =>
      `The sample shows ${p.crawlersShown} of the ${p.crawlers} crawler rows, the ones the check found blocked, and ${p.fixesShown} of the ${p.fixes} open fixes, the first by rank; a response holds them all. The links to a packet and to the edge list are left out.`,
    notes: `Rate limit ${READ_API.requestsPerMinute} requests a minute. Keys will be created and revoked in Settings; the field reference is the sample above. Read-only means exactly that: nothing you send changes an audit.`,
  },
  roadmap: {
    title: 'Planned, in this order, top first',
    sub: 'No dates. Each ships when it is as reliable as the web app.',
    rows: [
      // Owner ruling (rulings-3 Q37): planned, with no date. MCP is after v1 (OPERATING-RULES §8).
      {
        item: 'Write API: start an audit, mark a fix done, trigger a re-check',
        status: 'planned',
      },
      {
        item: 'MCP server, so Claude Code, Cursor and agents can audit and fix in one loop',
        status: 'planned',
      },
      { item: 'GitHub check: audit the preview deploy on every pull request', status: 'designed' },
      { item: 'CLI, ', code: 'npx crawlmouse audit', status: 'designed' },
      { item: 'Per-call pricing for agents without an account', status: 'planned' },
    ],
  },
  waitlist: {
    title: 'Hear when it ships',
    body: 'A separate, opt-in list for developers: one email per item above when it is live, and nothing else. Your account’s three kinds of email are unchanged by this; nothing on this list is sent to accounts that did not ask.',
    label: 'Developer updates',
    field: 'Email',
    placeholder: 'you@company.com',
    submit: 'Email me when it ships',
    sending: 'Adding you to the list…',
    done: 'You are on the list. One email per item above, when it ships.',
    preview: 'Preview only: nothing was sent.',
    invalid: 'Enter an email address, like you@company.com.',
    errors: {
      rate_limited: 'That was sent too many times today. Try again tomorrow.',
      captcha_failed: 'The check that you are a person did not pass. Try again.',
      'invalid input': 'That email address was not accepted. Check it and try again.',
      failed: 'You could not be added to the list. Try again.',
    } as Record<string, string>,
  },
  closing: {
    title: 'The audit itself works today, free, in about two minutes.',
    /** `crawlers`: the AI crawlers tested; `pages`: Free's page cap; `fixes`: the fixes Free opens. */
    sub: (p: { crawlers: string; pages: string; fixes: string }) =>
      `${p.crawlers} AI crawlers on a sample of pages from every template, up to ${p.pages} pages crawled, and the ${p.fixes} largest fixes as packets your coding tool can run.`,
    formLabel: 'Audit a site',
    homeLink: 'Start the audit on the home page',
  },
} as const;
