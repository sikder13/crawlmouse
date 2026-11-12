/**
 * The id in an `/audit/<id>` or `/api/audits/<id>` address is the right to read that check or
 * audit, as the id after `/checks/` is (CC-22b review, sec:S1). The scrubber's other rules, and the
 * SDK's own pipeline, are tested in __tests__/v2/account-door-sentry.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scrubDoorSecrets, sentryBrowserOptions, sentryServerOptions } from './sentry-scrub';

const ID = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const ORIGIN = 'https://crawlmouse.com';

describe('scrubDoorSecrets, an id in an audit address', () => {
  it.each([
    ['the id alone', `/audit/${ID}`, '/audit/[Filtered]'],
    ['a trailing path', `/audit/${ID}/fix/f-1`, '/audit/[Filtered]/fix/f-1'],
    ['a trailing slash', `/audit/${ID}/`, '/audit/[Filtered]/'],
    ['a query', `/audit/${ID}?tab=access#top`, '/audit/[Filtered]?tab=access#top'],
    ['upper case', `/AUDIT/${ID.toUpperCase()}/OVERVIEW`, '/AUDIT/[Filtered]/OVERVIEW'],
    ['encoded slashes', `next=%2Faudit%2F${ID}%2Fmap`, 'next=%2Faudit%2F[Filtered]%2Fmap'],
    ['lower-case encoding', `next=%2faudit%2f${ID}`, 'next=%2faudit%2f[Filtered]'],
    ['encoded twice', `a=%252Faudit%252F${ID}%252Fmap`, 'a=%252Faudit%252F[Filtered]%252Fmap'],
    ['an absolute URL', `${ORIGIN}/audit/${ID}/overview`, `${ORIGIN}/audit/[Filtered]/overview`],
    ['v1’s API path', `GET /api/audits/${ID}/stream`, 'GET /api/audits/[Filtered]/stream'],
    ['a check path, as before', `/api/checks/${ID}/stream`, '/api/checks/[Filtered]/stream'],
    [
      'two in one string',
      `/audit/${ID} from /audit/${ID}/map`,
      '/audit/[Filtered] from /audit/[Filtered]/map',
    ],
  ])('%s', (_, text, scrubbed) => {
    expect(scrubDoorSecrets({ text }).text).toBe(scrubbed);
  });

  it('leaves an id that follows no such path, and a path that only ends in the word', () => {
    for (const text of [ID, `/users/${ID}`, `/myaudit/${ID}`, `/audit-log/${ID}`, `?audit=${ID}`]) {
      expect(scrubDoorSecrets({ text }).text).toBe(text);
    }
  });

  it('in each place an event holds an address: URL, transaction, Referer, breadcrumbs, spans', () => {
    const event = {
      transaction: `GET /audit/${ID}/overview`,
      request: {
        url: `${ORIGIN}/audit/${ID}/overview`,
        headers: { Referer: `${ORIGIN}/audit/${ID}/access`, referer: `${ORIGIN}/audit/${ID}` },
      },
      breadcrumbs: [
        { category: 'navigation', data: { from: `/audit/${ID}/overview`, to: `/audit/${ID}/map` } },
        { category: 'fetch', data: { url: `/api/checks/${ID}/stream`, method: 'GET' } },
        { category: 'console', message: `opened ${ORIGIN}/audit/${ID}/fix/f-1` },
      ],
      spans: [
        { description: `GET /api/checks/${ID}/notify`, data: { 'http.url': `/audit/${ID}` } },
      ],
      contexts: { trace: { data: { 'http.target': `/audit/${ID}/overview?x=1` } } },
    };
    const out = scrubDoorSecrets(event);
    expect(JSON.stringify(out)).not.toContain(ID);
    expect(out.transaction).toBe('GET /audit/[Filtered]/overview');
    expect(out.breadcrumbs[1]!.data).toEqual({
      url: '/api/checks/[Filtered]/stream',
      method: 'GET',
    });
  });
});

describe('the SDK options that run the scrubber', () => {
  const event = () => ({ request: { url: `${ORIGIN}/audit/${ID}/overview` } });
  const scrubbedEvent = { request: { url: `${ORIGIN}/audit/[Filtered]/overview` } };

  it('the browser’s: on each event and each transaction', () => {
    const options = sentryBrowserOptions();
    expect(Object.keys(options).sort()).toEqual(['beforeSend', 'beforeSendTransaction']);
    expect(options.beforeSend(event())).toEqual(scrubbedEvent);
    expect(options.beforeSendTransaction(event())).toEqual(scrubbedEvent);
  });

  it('the server’s: on each event and each transaction', () => {
    const options = sentryServerOptions(() => 'integration');
    expect(options.beforeSend(event())).toEqual(scrubbedEvent);
    expect(options.beforeSendTransaction(event())).toEqual(scrubbedEvent);
  });

  // instrumentation-client.ts runs Sentry.init and posthog.init when it is imported, so its source
  // is read (as __tests__/replay-privacy.test.ts does), with comments taken out first.
  it('instrumentation-client.ts spreads the browser’s options into its one Sentry.init', () => {
    const source = readFileSync(resolve(__dirname, '../../instrumentation-client.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const inits = source.match(/Sentry\.init\(\{[\s\S]*?\}\);/g) ?? [];
    expect(inits).toHaveLength(1);
    expect(inits[0]).toMatch(/\.\.\.sentryBrowserOptions\(\),\s*\}\);$/);
    expect(inits[0]).not.toMatch(/beforeSend/);
  });
});

describe('scrubDoorSecrets, a Slack webhook in any shape the stored URL may take (CC-28)', () => {
  it.each([
    ['today’s shape', 'https://hooks.slack.com/services/T0001/B0002/SLACKSECRETabc123'],
    [
      'underscore and dash in the secret',
      'https://hooks.slack.com/services/T0001/B0002/SLACK_SECRET-x',
    ],
    ['a team id not starting with T', 'https://hooks.slack.com/services/E0001/B0002/SLACKSECRET'],
    ['no team or bot segments', 'https://hooks.slack.com/services/SLACKSECRET'],
    ['more segments', 'https://hooks.slack.com/services/T1/B2/C3/SLACKSECRET'],
    ['encoded slashes', 'https%3A%2F%2Fhooks.slack.com%2Fservices%2FT1%2FB2%2FSLACKSECRET'],
  ])('%s', (_, url) => {
    const out = JSON.stringify(scrubDoorSecrets({ url, breadcrumbs: [{ data: { url } }] }));
    expect(out).not.toMatch(/SLACK_?SECRET/);
    expect(out).toContain('services');
  });
});
