// @vitest-environment jsdom
/**
 * The first-touch cookie and surveys follow consent (CC-41 D2, D8; F-048): instrumentation-client.ts
 * does not start PostHog for a visitor who has not agreed where agreement is needed, or who declined
 * (`__tests__/consent-no-tracking.dom.test.tsx` runs that against the real SDK), and writes `cm_ft`
 * only when analytics may run, or on the banner's grant; the banner's decline switches surveys off.
 * posthog-js and Sentry are replaced; instrumentation-client.ts runs at import, so each case loads it
 * afresh.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstTouchFromCookies } from '@/lib/analytics/first-touch';

const ph = vi.hoisted(() => ({
  loaded: false,
  optedOut: false,
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  set_config: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: {
    get __loaded() {
      return ph.loaded;
    },
    init: (key: string, config: object) => {
      ph.init(key, config);
      ph.loaded = true;
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
  ph.loaded = false;
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
    await load('/blog/x?utm_source=linkedin', ['cm_consent_required=0']);
    expect(ph.init.mock.calls[0]![1]).toMatchObject({ disable_surveys: false });
    expect(firstTouchFromCookies(document.cookie)).toMatchObject({
      utm_source: 'linkedin',
      landing_path: '/blog/x',
    });
  });

  it('does not start PostHog, and writes no cm_ft, before consent where it is required', async () => {
    await load('/?utm_source=linkedin', ['cm_consent_required=1']);
    expect(ph.init).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('cm_ft=');
  });

  it('does not start PostHog after a decline recorded outside the consent regions', async () => {
    localStorage.setItem('cm_consent', 'denied');
    await load('/pricing', ['cm_consent_required=0']);
    expect(ph.init).not.toHaveBeenCalled();
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
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.init.mock.calls[0]![1]).toMatchObject({ disable_surveys: false });
    // Before `init` the SDK's opt-in writes to storage, so the banner does not call it.
    expect(ph.opt_in_capturing).not.toHaveBeenCalled();
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

  it('on decline before PostHog started, calls nothing of the SDK and announces it', async () => {
    const heard = vi.fn();
    window.addEventListener('cm:consent-denied', heard);
    const b = await banner();
    b.click('Decline');
    expect(ph.opt_out_capturing).not.toHaveBeenCalled();
    expect(ph.set_config).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener('cm:consent-denied', heard);
    b.done();
  });

  it('on decline once PostHog runs, opts out, turns surveys and persistence off, and announces it', async () => {
    ph.loaded = true;
    const heard = vi.fn();
    window.addEventListener('cm:consent-denied', heard);
    const b = await banner();
    b.click('Decline');
    expect(ph.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(ph.set_config).toHaveBeenCalledWith({
      disable_surveys: true,
      disable_persistence: true,
      opt_out_capturing_by_default: true,
    });
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener('cm:consent-denied', heard);
    b.done();
  });

  it('on allow before PostHog started, calls nothing of the SDK and announces the grant', async () => {
    const heard = vi.fn();
    window.addEventListener('cm:consent-granted', heard);
    const b = await banner();
    b.click('Allow analytics');
    expect(ph.opt_in_capturing).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(ph.set_config).not.toHaveBeenCalled();
    window.removeEventListener('cm:consent-granted', heard);
    b.done();
  });

  it('on allow once PostHog runs, turns it back on and opts in', async () => {
    ph.loaded = true;
    const heard = vi.fn();
    window.addEventListener('cm:consent-granted', heard);
    const b = await banner();
    b.click('Allow analytics');
    expect(ph.set_config).toHaveBeenCalledWith({
      disable_persistence: false,
      opt_out_capturing_by_default: false,
      disable_surveys: false,
    });
    expect(ph.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener('cm:consent-granted', heard);
    b.done();
  });
});
