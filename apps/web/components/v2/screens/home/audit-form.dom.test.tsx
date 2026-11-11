// @vitest-environment jsdom
/**
 * The Home form against `POST /api/checks` (CC-22b D2, D10), with the route's contract mocked:
 * body `{url, requestId, turnstileToken?}`, 200 `{checkId}`, and its refusal codes.
 */
import { act, forwardRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeepBar } from '../result/KeepBar';
import { AuditEvent, AuditPageProvider } from '../result/AuditPage';
import { AuditForm } from './AuditForm';
import { START_COPY, START_REFUSALS, startCheck, urlOf } from './start-check';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The person check's widget, as a button that answers with a token when pressed. */
const turnstile = vi.hoisted(() => ({
  siteKey: undefined as string | undefined,
  token: 'tok-1' as string | null,
}));
vi.mock('@/lib/turnstile-client', () => ({
  turnstileEnabled: (key: string | undefined) => !!key,
  get TURNSTILE_SITE_KEY() {
    return turnstile.siteKey;
  },
}));
vi.mock('@/components/ui/Turnstile', () => ({
  Turnstile: forwardRef<unknown, { onToken: (t: string | null) => void }>(function T(
    { onToken },
    _ref,
  ) {
    return (
      <button type="button" data-testid="widget" onClick={() => onToken(turnstile.token)}>
        widget
      </button>
    );
  }),
}));
const tracked = vi.hoisted(() => [] as [string, unknown][]);
vi.mock('../../../../lib/analytics', () => ({
  track: (event: string, props: unknown) => tracked.push([event, props]),
}));

const CHECK = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let root: Root | null = null;
let calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[];
let answers: Response[];
let went: string[];

beforeEach(() => {
  calls = [];
  answers = [];
  went = [];
  tracked.length = 0;
  turnstile.siteKey = undefined;
  turnstile.token = 'tok-1';
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      headers: init.headers as Record<string, string>,
    });
    const next = answers.shift();
    if (!next) throw new Error('network down');
    return next;
  });
  vi.stubGlobal('location', { ...window.location, assign: (u: string) => went.push(u) });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
async function submit(host: HTMLElement, typed: string) {
  (host.querySelector('input[name="url"]') as HTMLInputElement).value = typed;
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}
const alertOf = (host: HTMLElement) => host.querySelector('[role="alert"]')!.textContent;
const form = () => mount(<AuditForm fieldId="url" primary start />);

describe('the Home form, starting an audit', () => {
  it('posts the address and a fresh request id as JSON, then opens the audit', async () => {
    const host = form();
    answers.push(json(200, { checkId: CHECK }));
    await submit(host, 'Example.com/shop');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/checks');
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(Object.keys(calls[0]!.body).sort()).toEqual(['requestId', 'url']);
    expect(calls[0]!.body.url).toBe('https://Example.com/shop');
    expect(calls[0]!.body.requestId).toMatch(UUID);
    expect(went).toEqual([`/audit/${CHECK}`]);
    expect(alertOf(host)).toBe('');
  });

  it('refuses an address that is not a public site before any request', async () => {
    const host = form();
    await submit(host, '10.0.0.1');
    await submit(host, '');
    expect(calls).toEqual([]);
    expect(alertOf(host)).not.toBe('');
  });

  it('the preview form posts nowhere', async () => {
    const host = mount(<AuditForm fieldId="url" primary />);
    await submit(host, 'example.com');
    expect(calls).toEqual([]);
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Preview only');
  });

  it('a second submit mints a second request id, so trying again after a failure is a new check', async () => {
    const host = form();
    answers.push(json(503, { code: 'capacity' }), json(200, { checkId: CHECK }));
    await submit(host, 'example.com');
    await submit(host, 'example.com');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.requestId).not.toBe(calls[1]!.body.requestId);
    expect(went).toEqual([`/audit/${CHECK}`]);
  });

  it.each(START_REFUSALS.filter((c) => c !== 'captcha_required'))(
    'says its own sentence for %s and lets the visitor try again',
    async (code) => {
      const host = form();
      answers.push(
        json(
          code.startsWith('invalid')
            ? 400
            : code.includes('captcha') || code === 'domain_limit'
              ? 429
              : 503,
          { code },
        ),
      );
      await submit(host, 'example.com');
      expect(alertOf(host)).toBe(START_COPY[code]);
      expect(went).toEqual([]);
      expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
        false,
      );
    },
  );

  it('each refusal has a sentence of its own', () => {
    expect(new Set(Object.values(START_COPY)).size).toBe(START_REFUSALS.length + 1);
  });

  it('an answer it does not know, an upstream message, or no answer, is the general sentence', async () => {
    for (const answer of [
      json(500, { error: 'ECONNRESET at 10.1.2.3' }),
      json(429, { code: 'nope' }),
      null,
    ]) {
      const host = form();
      if (answer) answers.push(answer);
      await submit(host, 'example.com');
      expect(alertOf(host)).toBe(START_COPY.failed);
      act(() => root?.unmount());
      document.body.innerHTML = '';
    }
  });

  it('does not follow a 200 whose check id is not a uuid', async () => {
    const host = form();
    answers.push(json(200, { checkId: '../../login?next=//evil.example' }));
    await submit(host, 'example.com');
    expect(went).toEqual([]);
    expect(alertOf(host)).toBe(START_COPY.failed);
  });

  it('asked for the person check, shows the widget and sends its token with the same request id', async () => {
    turnstile.siteKey = 'site-key';
    const host = form();
    answers.push(json(429, { code: 'captcha_required' }), json(200, { checkId: CHECK }));
    await submit(host, 'example.com');
    expect(host.querySelector('[role="status"]')!.textContent).toBe(START_COPY.captcha_required);
    expect(went).toEqual([]);
    await act(async () => {
      (host.querySelector('[data-testid="widget"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual({ ...calls[0]!.body, turnstileToken: 'tok-1' });
    expect(went).toEqual([`/audit/${CHECK}`]);
  });

  it('a person check that fails, is asked twice, or has no widget to answer it, is said as failed', async () => {
    turnstile.siteKey = 'site-key';
    turnstile.token = null;
    let host = form();
    answers.push(json(429, { code: 'captcha_required' }));
    await submit(host, 'example.com');
    await act(async () => {
      (host.querySelector('[data-testid="widget"]') as HTMLButtonElement).click();
    });
    expect(alertOf(host)).toBe(START_COPY.captcha_failed);
    expect(calls).toHaveLength(1);

    act(() => root?.unmount());
    turnstile.token = 'tok-2';
    host = form();
    answers.push(json(429, { code: 'captcha_required' }), json(429, { code: 'captcha_required' }));
    await submit(host, 'example.com');
    await act(async () => {
      (host.querySelector('[data-testid="widget"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(alertOf(host)).toBe(START_COPY.captcha_failed);
    expect(host.querySelector('[data-testid="widget"]')).toBeNull();

    act(() => root?.unmount());
    turnstile.siteKey = undefined;
    host = form();
    answers.push(json(429, { code: 'captcha_required' }));
    await submit(host, 'example.com');
    expect(alertOf(host)).toBe(START_COPY.captcha_failed);
  });
});

describe('startCheck and urlOf', () => {
  it('adds https:// to an address with no scheme and leaves one with a scheme as typed', () => {
    expect(urlOf('  example.com ')).toBe('https://example.com');
    expect(urlOf('http://example.com:8080/a')).toBe('http://example.com:8080/a');
  });

  it('answers failed when the request itself fails', async () => {
    expect(await startCheck({ url: 'https://example.com', requestId: CHECK })).toEqual({
      ok: false,
      code: 'failed',
    });
  });
});

describe('the audit pages’ client events', () => {
  const page = { checkId: CHECK, checkRef: 'ref-of-the-check', from: 'fix' as const, links: {} };

  it('result_viewed and fix_opened are sent once, with the props given', () => {
    mount(
      <AuditPageProvider page={page}>
        <AuditEvent
          event="fix_opened"
          props={{ type: 'orphan_pages', free: true, check_ref: page.checkRef }}
        />
      </AuditPageProvider>,
    );
    expect(tracked).toEqual([
      ['fix_opened', { type: 'orphan_pages', free: true, check_ref: 'ref-of-the-check' }],
    ]);
  });

  it('keep_clicked is sent on a Keep submit with the page and the check’s reference, never its id', async () => {
    answers.push(json(200, { ok: true }));
    const host = mount(
      <AuditPageProvider page={page}>
        <KeepBar domain="x.com" expires="26 Oct, 02:34 UTC" initial="open" />
      </AuditPageProvider>,
    );
    (host.querySelector('input[name="email"]') as HTMLInputElement).value = 'keeper@example.com';
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(tracked).toEqual([['keep_clicked', { from: 'fix', check_ref: 'ref-of-the-check' }]]);
    expect(JSON.stringify(tracked)).not.toContain(CHECK);
    // The claim itself carries the id, to the sign-in route.
    expect(calls[0]).toMatchObject({ url: '/api/auth/magic-link', body: { claimCheckId: CHECK } });
  });

  it('a preview, which has no page around it, sends no event and claims nothing', async () => {
    const host = mount(<KeepBar domain="x.com" expires="26 Oct, 02:34 UTC" initial="open" />);
    (host.querySelector('input[name="email"]') as HTMLInputElement).value = 'keeper@example.com';
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(tracked).toEqual([]);
    expect(calls).toEqual([]);
  });
});
