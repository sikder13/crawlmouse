// @vitest-environment jsdom
/**
 * The first-touch cookie and surveys follow consent (CC-41 D2, D8): instrumentation-client.ts starts
 * PostHog with surveys off for a visitor who is opted out by default and writes `cm_ft` only when
 * capture is not opted out, or on the banner's grant; the banner's decline switches surveys off.
 * posthog-js and Sentry are replaced; instrumentation-client.ts runs at import, so each case loads it
 * afresh.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstTouchFromCookies } from '@/lib/analytics/first-touch';

const ph = vi.hoisted(() => ({
  optedOut: false,
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  set_config: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: {
    init: (key: string, config: { opt_out_capturing_by_default?: boolean }) => {
      ph.init(key, config);
      ph.optedOut = config.opt_out_capturing_by_default === true;
    },
    has_opted_out_capturing: () => ph.optedOut,
    startSessionRecording: () => undefined,
    opt_in_capturing: () => {
      ph.opt_in_capturing();
      ph.optedOut = false;
    },
    opt_out_capturing: () => {
      ph.opt_out_capturing();
      ph.optedOut = true;
    },
    set_config: ph.set_config,
  },
}));
vi.mock('@sentry/nextjs', () => ({
  init: () => undefined,
  captureRouterTransitionStart: () => undefined,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function clearCookies() {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]!.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

/** The window listeners each load of instrumentation-client adds, removed after each case. */
const added: [string, EventListenerOrEventListenerObject][] = [];
const addListener = window.addEventListener.bind(window);

async function load(path: string, cookies: string[] = []) {
  vi.resetModules();
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    added.push([type, listener]);
    addListener(type, listener, options);
  });
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', ['phc', 'test'].join('_'));
  for (const c of cookies) document.cookie = `${c}; Path=/`;
  window.history.replaceState(null, '', path);
  await import('../instrumentation-client');
  vi.mocked(window.addEventListener).mockRestore();
}

beforeEach(() => {
  clearCookies();
  localStorage.clear();
  ph.optedOut = false;
  for (const f of [ph.init, ph.opt_in_capturing, ph.opt_out_capturing, ph.set_config]) {
    f.mockClear();
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const [type, listener] of added.splice(0)) window.removeEventListener(type, listener);
});

describe('instrumentation-client', () => {
  it('starts PostHog with surveys on, and writes cm_ft, when consent is not required', async () => {
    await load('/blog/x?utm_source=linkedin');
    expect(ph.init.mock.calls[0]![1]).toMatchObject({
      opt_out_capturing_by_default: false,
      disable_surveys: false,
    });
    expect(firstTouchFromCookies(document.cookie)).toMatchObject({
      utm_source: 'linkedin',
      landing_path: '/blog/x',
    });
  });

  it('starts PostHog with surveys off, and writes no cm_ft, before consent where it is required', async () => {
    await load('/?utm_source=linkedin', ['cm_consent_required=1']);
    expect(ph.init.mock.calls[0]![1]).toMatchObject({
      opt_out_capturing_by_default: true,
      disable_surveys: true,
    });
    expect(document.cookie).not.toContain('cm_ft=');
  });

  it('writes cm_ft for the landing page on the banner grant, not for a later page', async () => {
    await load('/guides/a?utm_source=reddit', ['cm_consent_required=1']);
    window.history.replaceState(null, '', '/pricing?utm_source=other');
    const { CookieConsent } = await import('@/components/consent/CookieConsent');
    const host = document.createElement('div');
    document.body.append(host);
    const root: Root = createRoot(host);
    act(() => root.render(<CookieConsent />));
    const allow = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Allow analytics',
    );
    act(() => allow!.click());
    expect(ph.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(firstTouchFromCookies(document.cookie)).toMatchObject({
      utm_source: 'reddit',
      landing_path: '/guides/a',
    });
    act(() => root.unmount());
    host.remove();
  });

  it('never overwrites a cm_ft already there', async () => {
    const kept = encodeURIComponent(
      JSON.stringify({ utm_source: 'first', first_seen_at: '2026-11-01T00:00:00Z' }),
    );
    await load('/?utm_source=second', [`cm_ft=${kept}`]);
    expect(firstTouchFromCookies(document.cookie)?.utm_source).toBe('first');
  });
});

describe('the consent banner', () => {
  async function banner() {
    document.cookie = 'cm_consent_required=1; Path=/';
    const { CookieConsent } = await import('@/components/consent/CookieConsent');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<CookieConsent />));
    const click = (label: string) =>
      act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!.click());
    return { click, done: () => (act(() => root.unmount()), host.remove()) };
  }

  it('on decline opts out and switches surveys off', async () => {
    const b = await banner();
    b.click('Decline');
    expect(ph.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(ph.set_config).toHaveBeenCalledWith({ disable_surveys: true });
    b.done();
  });

  it('on allow opts in and announces the grant', async () => {
    const heard = vi.fn();
    window.addEventListener('cm:consent-granted', heard);
    const b = await banner();
    b.click('Allow analytics');
    expect(ph.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(ph.set_config).not.toHaveBeenCalled();
    window.removeEventListener('cm:consent-granted', heard);
    b.done();
  });
});
