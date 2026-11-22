// @vitest-environment jsdom
/**
 * F-048, against the real posthog-js: where consent is needed and not given, or after a decline, the
 * browser holds no PostHog cookie or storage and sends PostHog nothing. instrumentation-client.ts runs
 * at import, so each case loads it afresh. Only Sentry and the network are replaced.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  init: () => undefined,
  captureRouterTransitionStart: () => undefined,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = ['phc', 'consenttest'].join('_');
const PH_NAME = /^(__)?ph_/;

let requests: string[];
const added: [string, EventListenerOrEventListenerObject][] = [];
const addListener = window.addEventListener.bind(window);
/** Each case's SDK instance, retired when the case ends. */
const instances: { _send_request: unknown; _send_retriable_request: unknown }[] = [];

function clearAll() {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]!.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
  localStorage.clear();
  sessionStorage.clear();
  for (const s of document.querySelectorAll('script')) s.remove();
  document.body.innerHTML = '';
}

/** Everything of PostHog's the browser holds or was asked to fetch. */
const traces = () => ({
  cookies: document.cookie
    .split(';')
    .map((c) => c.split('=')[0]!.trim())
    .filter((n) => PH_NAME.test(n)),
  local: Object.keys(localStorage).filter((k) => PH_NAME.test(k)),
  session: Object.keys(sessionStorage).filter((k) => PH_NAME.test(k)),
  scripts: [...document.querySelectorAll('script')].map((s) => s.src).filter(Boolean),
  requests: [...requests],
});
const NOTHING = { cookies: [], local: [], session: [], scripts: [], requests: [] };

/** The PostHog keys only, so a next load in one case starts from the visitor's own choice. */
function clearPostHogOnly() {
  for (const k of Object.keys(localStorage)) if (PH_NAME.test(k)) localStorage.removeItem(k);
  for (const k of Object.keys(sessionStorage)) if (PH_NAME.test(k)) sessionStorage.removeItem(k);
}

const settle = () => new Promise((r) => setTimeout(r, 60));

async function load(cookies: string[], stored?: 'granted' | 'denied') {
  vi.resetModules();
  // `vi.resetModules` does not reload an external package, and a `vi.mock` factory's result is kept
  // across it, so the SDK's singleton would carry its state from one case to the next. Each load
  // registers a new instance of the real class.
  vi.doMock('posthog-js', async (original) => {
    const real = await original<typeof import('posthog-js')>();
    return { ...real, default: new real.PostHog() };
  });
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    added.push([type, listener as EventListenerOrEventListenerObject]);
    addListener(type, listener as EventListenerOrEventListenerObject, options);
  });
  for (const c of cookies) document.cookie = `${c}; Path=/`;
  if (stored) localStorage.setItem('cm_consent', stored);
  await import('../instrumentation-client');
  vi.mocked(window.addEventListener).mockRestore();
  await settle();
  const posthog = (await import('posthog-js')).default;
  instances.push(posthog);
  return posthog;
}

async function banner() {
  const { CookieConsent } = await import('@/components/consent/CookieConsent');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<CookieConsent />));
  return {
    click: async (label: string) => {
      const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
      act(() => button!.click());
      await settle();
    },
    open: () => act(() => void window.dispatchEvent(new Event('cm:open-consent'))),
    done: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  clearAll();
  requests = [];
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY);
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://us.i.posthog.com');
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    requests.push(String(input instanceof Request ? input.url : input));
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url: string) => {
      requests.push(url);
      return true;
    },
  });
});
afterEach(() => {
  // A case's SDK is retired with it. Its queue's timer would otherwise post this case's events into
  // the next case's list, where a slow run reads them as a request made without consent.
  for (const instance of instances.splice(0)) {
    instance._send_request = () => undefined;
    instance._send_retriable_request = () => undefined;
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const [type, listener] of added.splice(0)) window.removeEventListener(type, listener);
});

describe('no PostHog before consent, or after a decline', () => {
  it.each([
    ['in the EU or UK with no choice yet', ['cm_consent_required=1'], undefined],
    ['with no region cookie at all (fails closed)', [], undefined],
    ['in the EU after a decline', ['cm_consent_required=1'], 'denied'],
    ['outside the EU after a decline', ['cm_consent_required=0'], 'denied'],
    [
      'with a decline only in the cookie',
      ['cm_consent_required=0', 'cm_consent=denied'],
      undefined,
    ],
  ] as const)('%s: no cookie, storage, script or request', async (_, cookies, stored) => {
    const posthog = await load([...cookies], stored);
    expect(posthog.__loaded).toBe(false);
    expect(traces()).toEqual(NOTHING);
  });

  it('an error on the page before consent records nothing', async () => {
    await load(['cm_consent_required=1']);
    window.dispatchEvent(new Event('error'));
    await settle();
    expect(traces()).toEqual(NOTHING);
  });

  it('a product event tracked before consent stores and sends nothing', async () => {
    await load(['cm_consent_required=1']);
    const { track } = await import('@/lib/analytics');
    track('check_started');
    await settle();
    expect(traces()).toEqual(NOTHING);
  });

  it('removes what an earlier version left behind, on a page that may not start', async () => {
    document.cookie = `ph_${KEY}_posthog=%7B%7D; Path=/`;
    localStorage.setItem(`ph_${KEY}_posthog`, '{}');
    localStorage.setItem(`__ph_opt_in_out_${KEY}`, '0');
    sessionStorage.setItem(`ph_${KEY}_posthog`, '{}');
    localStorage.setItem('unrelated', 'kept');
    await load(['cm_consent_required=1']);
    expect(traces()).toEqual(NOTHING);
    expect(localStorage.getItem('unrelated')).toBe('kept');
  });

  it('the banner’s Decline before PostHog started writes nothing of PostHog’s', async () => {
    await load(['cm_consent_required=1']);
    const b = await banner();
    await b.click('Decline');
    expect(localStorage.getItem('cm_consent')).toBe('denied');
    expect(traces()).toEqual(NOTHING);
    b.done();
  });

  it('a Decline after an Allow, on the same page, removes it all and sends nothing more', async () => {
    const posthog = await load(['cm_consent_required=1']);
    const b = await banner();
    await b.click('Allow analytics');
    expect(posthog.__loaded).toBe(true);
    expect(traces().cookies).toEqual([`ph_${KEY}_posthog`]);
    b.open();
    await b.click('Decline');
    const sent = requests.length;
    expect({ ...traces(), scripts: [], requests: [] }).toEqual(NOTHING);
    posthog.capture('after-decline');
    posthog.register({ later: 1 });
    await settle();
    expect({ ...traces(), scripts: [], requests: [] }).toEqual(NOTHING);
    expect(requests.length).toBe(sent);
    expect(posthog.has_opted_out_capturing()).toBe(true);
    b.done();
  });
});

describe('after a decline, on a page that stays open', () => {
  const REFRESH_MS = 5 * 60 * 1000;
  const flags = () => requests.filter((u) => u.includes('/flags'));

  /** Allowed analytics with the remote config loaded: what starts the SDK's refresh timer. */
  async function running() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const posthog = await load(['cm_consent_required=0']);
    const config = [...document.querySelectorAll('script')].find((s) =>
      s.src.includes('config.js'),
    );
    config!.dispatchEvent(new Event('load'));
    await settle();
    live = posthog;
    return posthog;
  }
  let live: Awaited<ReturnType<typeof load>> | null = null;
  // A running instance would keep sending into the next case's list.
  afterEach(async () => {
    live?.opt_out_capturing();
    live?.set_config({ advanced_disable_flags: true, disable_persistence: true });
    live = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    await settle();
  });

  it('the refresh does call /flags while analytics run (the control)', async () => {
    await running();
    const before = flags().length;
    vi.advanceTimersByTime(REFRESH_MS);
    await settle();
    expect(flags().length).toBeGreaterThan(before);
  });

  it('sends nothing on the refresh timer, on sign-out’s reset, or when asked for flags', async () => {
    const posthog = await running();
    const b = await banner();
    b.open();
    await b.click('Decline');
    const sent = requests.length;
    vi.advanceTimersByTime(REFRESH_MS * 2);
    await settle();
    posthog.reset();
    await settle();
    posthog.reloadFeatureFlags();
    await settle();
    posthog.capture('after-decline');
    await settle();
    expect(requests.slice(sent)).toEqual([]);
    b.done();
  });

  it('a later Allow turns the refresh back on', async () => {
    await running();
    const b = await banner();
    b.open();
    await b.click('Decline');
    b.open();
    await b.click('Allow analytics');
    const before = flags().length;
    vi.advanceTimersByTime(REFRESH_MS);
    await settle();
    expect(flags().length).toBeGreaterThan(before);
    b.done();
  });
});

describe('the privacy review’s cases', () => {
  it('a Decline in another tab stops this one, and it writes and sends nothing more', async () => {
    const posthog = await load(['cm_consent_required=0']);
    expect(posthog.__loaded).toBe(true);
    // Another tab recorded the choice and cleared the shared keys.
    localStorage.setItem('cm_consent', 'denied');
    for (const k of Object.keys(localStorage)) if (PH_NAME.test(k)) localStorage.removeItem(k);
    window.dispatchEvent(new StorageEvent('storage', { key: 'cm_consent', newValue: 'denied' }));
    await settle();
    expect(posthog.has_opted_out_capturing()).toBe(true);
    const sent = requests.length;
    posthog.capture('from-the-other-tab');
    posthog.register({ later: 1 });
    await settle();
    expect({ ...traces(), scripts: [], requests: [] }).toEqual(NOTHING);
    expect(requests.length).toBe(sent);
  });

  it('an Allow in another tab starts PostHog in this one', async () => {
    const posthog = await load(['cm_consent_required=1']);
    expect(posthog.__loaded).toBe(false);
    localStorage.setItem('cm_consent', 'granted');
    window.dispatchEvent(new StorageEvent('storage', { key: 'cm_consent', newValue: 'granted' }));
    await settle();
    expect(posthog.__loaded).toBe(true);
  });

  it('a choice in another tab is announced to this page’s listeners', async () => {
    await load(['cm_consent_required=0']);
    const heard: string[] = [];
    const denied = () => heard.push('denied');
    const granted = () => heard.push('granted');
    window.addEventListener('cm:consent-denied', denied);
    window.addEventListener('cm:consent-granted', granted);
    localStorage.setItem('cm_consent', 'denied');
    window.dispatchEvent(new StorageEvent('storage', { key: 'cm_consent', newValue: 'denied' }));
    localStorage.setItem('cm_consent', 'granted');
    window.dispatchEvent(new StorageEvent('storage', { key: 'cm_consent', newValue: 'granted' }));
    window.removeEventListener('cm:consent-denied', denied);
    window.removeEventListener('cm:consent-granted', granted);
    expect(heard).toEqual(['denied', 'granted']);
  });

  it('a grant on the console sends nothing, with PostHog already loaded', async () => {
    const posthog = await load(['cm_consent_required=0']);
    const b = await banner();
    b.open();
    await b.click('Decline');
    const sent = requests.length;
    window.history.pushState(null, '', '/internal/accounts/abc');
    localStorage.setItem('cm_consent', 'granted');
    window.dispatchEvent(new StorageEvent('storage', { key: 'cm_consent', newValue: 'granted' }));
    await settle();
    expect(requests.length).toBe(sent);
    expect(posthog.has_opted_out_capturing()).toBe(true);
    b.done();
  });

  it('a Decline with a full store is not undone by an earlier grant still in it', async () => {
    const posthog = await load(['cm_consent_required=1'], 'granted');
    expect(posthog.__loaded).toBe(true);
    const b = await banner();
    b.open();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await b.click('Decline');
    setItem.mockRestore();
    expect(localStorage.getItem('cm_consent')).toBeNull();
    expect(document.cookie).toContain('cm_consent=denied');
    b.done();
    clearPostHogOnly();
    const next = await load([]);
    expect(next.__loaded).toBe(false);
  });

  it('a recorded decline outside the EU removes what an earlier version left behind', async () => {
    document.cookie = `ph_${KEY}_posthog=%7B%7D; Path=/`;
    localStorage.setItem(`ph_${KEY}_posthog`, '{}');
    await load(['cm_consent_required=0'], 'denied');
    expect(traces()).toEqual(NOTHING);
  });

  it('a page with no region cookie holds analytics and removes nothing', async () => {
    localStorage.setItem(`ph_${KEY}_posthog`, '{}');
    const posthog = await load([]);
    expect(posthog.__loaded).toBe(false);
    expect(localStorage.getItem(`ph_${KEY}_posthog`)).toBe('{}');
  });

  it('after a Decline, a later error starts no recording', async () => {
    const posthog = await load(['cm_consent_required=0']);
    const record = vi.spyOn(posthog, 'startSessionRecording').mockImplementation(() => undefined);
    const b = await banner();
    b.open();
    await b.click('Decline');
    window.dispatchEvent(new Event('error'));
    await settle();
    expect(record).not.toHaveBeenCalled();
    b.done();
  });

  it('with Allow, an error starts the recording: the check above can fail', async () => {
    const posthog = await load(['cm_consent_required=0']);
    const record = vi.spyOn(posthog, 'startSessionRecording').mockImplementation(() => undefined);
    window.dispatchEvent(new Event('error'));
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('a Decline here and an Allow in another tab leaves this tab capturing again', async () => {
    const posthog = await load(['cm_consent_required=0']);
    const b = await banner();
    b.open();
    await b.click('Decline');
    expect(posthog.has_opted_out_capturing()).toBe(true);
    localStorage.setItem('cm_consent', 'granted');
    window.dispatchEvent(new StorageEvent('storage', { key: 'cm_consent', newValue: 'granted' }));
    await settle();
    expect(posthog.has_opted_out_capturing()).toBe(false);
    b.done();
  });

  it('a Decline in a tab whose store is full still stops this one (no new value in the event)', async () => {
    const posthog = await load(['cm_consent_required=0']);
    document.cookie = 'cm_consent=denied; Path=/';
    localStorage.removeItem('cm_consent');
    window.dispatchEvent(new StorageEvent('storage', { key: 'cm_consent', newValue: null }));
    await settle();
    expect(posthog.has_opted_out_capturing()).toBe(true);
  });

  it('a late grant event does nothing once the recorded decision is a decline', async () => {
    const posthog = await load(['cm_consent_required=0']);
    const b = await banner();
    b.open();
    await b.click('Decline');
    const sent = requests.length;
    window.dispatchEvent(new StorageEvent('storage', { key: 'cm_consent', newValue: 'granted' }));
    await settle();
    expect(posthog.has_opted_out_capturing()).toBe(true);
    expect(requests.length).toBe(sent);
    b.done();
  });

  it('a page restored from the back/forward cache catches up with a Decline made meanwhile', async () => {
    const posthog = await load(['cm_consent_required=0']);
    localStorage.setItem('cm_consent', 'denied');
    const restored = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    await settle();
    expect(posthog.has_opted_out_capturing()).toBe(true);
    expect({ ...traces(), scripts: [], requests: [] }).toEqual(NOTHING);
  });

  it('a repeated storage event announces a choice once', async () => {
    await load(['cm_consent_required=0']);
    const heard = vi.fn();
    window.addEventListener('cm:consent-denied', heard);
    localStorage.setItem('cm_consent', 'denied');
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new StorageEvent('storage', { key: 'cm_consent', newValue: 'denied' }));
    }
    window.removeEventListener('cm:consent-denied', heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('the banner writes the cookie before storage, so another tab never reads the old cookie', async () => {
    await load(['cm_consent_required=1'], 'granted');
    const b = await banner();
    b.open();
    let cookieAtWrite = '';
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      cookieAtWrite = document.cookie;
    });
    await b.click('Decline');
    setItem.mockRestore();
    expect(cookieAtWrite).toContain('cm_consent=denied');
    b.done();
  });

  it('another key changing in storage does nothing', async () => {
    const posthog = await load(['cm_consent_required=0']);
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'denied' }));
    await settle();
    expect(posthog.has_opted_out_capturing()).toBe(false);
  });

  it('an Allow after a client navigation to the console does not start PostHog', async () => {
    const posthog = await load(['cm_consent_required=1']);
    const b = await banner();
    window.history.pushState(null, '', '/internal/accounts/abc');
    await b.click('Allow analytics');
    expect(posthog.__loaded).toBe(false);
    expect(traces()).toEqual(NOTHING);
    b.done();
  });

  it('a withdrawal removes the first-touch cookie and survey state too', async () => {
    await load(['cm_consent_required=1'], undefined);
    const b = await banner();
    await b.click('Allow analytics');
    expect(document.cookie).toContain('cm_ft=');
    localStorage.setItem('seenSurvey_a', '1');
    localStorage.setItem('lastSeenSurveyDate', '1');
    b.open();
    await b.click('Decline');
    expect(document.cookie).not.toContain('cm_ft=');
    expect(localStorage.getItem('seenSurvey_a')).toBeNull();
    expect(localStorage.getItem('lastSeenSurveyDate')).toBeNull();
    b.done();
  });

  it('storage the browser blocks does not stop the page from loading', async () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      const posthog = await load(['cm_consent_required=1']);
      expect(posthog.__loaded).toBe(false);
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });

  it('a Decline with a full store still stops PostHog and records it in the cookie', async () => {
    const posthog = await load(['cm_consent_required=0']);
    const b = await banner();
    b.open();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await b.click('Decline');
    setItem.mockRestore();
    expect(document.cookie).toContain('cm_consent=denied');
    expect(posthog.has_opted_out_capturing()).toBe(true);
    b.done();
  });
});

describe('PostHog where it may run', () => {
  it('starts at load outside the consent regions, through /ingest whatever the env says', async () => {
    const posthog = await load(['cm_consent_required=0']);
    expect(posthog.__loaded).toBe(true);
    expect(posthog.config.api_host).toBe('/ingest');
    expect(posthog.config.capture_dead_clicks).toBe(false);
    expect(posthog.config.capture_performance).toBe(false);
    const t = traces();
    expect(t.cookies).toEqual([`ph_${KEY}_posthog`]);
    expect([...t.scripts, ...t.requests].filter((u) => u.includes('posthog.com'))).toEqual([]);
    expect(t.scripts.some((s) => s.includes('/ingest/'))).toBe(true);
  });

  it('starts at load after a recorded grant in the EU', async () => {
    const posthog = await load(['cm_consent_required=1'], 'granted');
    expect(posthog.__loaded).toBe(true);
    expect(posthog.has_opted_out_capturing()).toBe(false);
  });

  it('starts on the banner’s Allow, and captures from then on', async () => {
    const posthog = await load(['cm_consent_required=1']);
    expect(traces()).toEqual(NOTHING);
    const b = await banner();
    await b.click('Allow analytics');
    expect(posthog.__loaded).toBe(true);
    expect(posthog.has_opted_out_capturing()).toBe(false);
    expect(traces().cookies).toEqual([`ph_${KEY}_posthog`]);
    b.done();
  });

  it('Allow, Decline, Allow on one page ends captured and persisted again', async () => {
    const posthog = await load(['cm_consent_required=1']);
    const b = await banner();
    await b.click('Allow analytics');
    b.open();
    await b.click('Decline');
    b.open();
    await b.click('Allow analytics');
    expect(posthog.has_opted_out_capturing()).toBe(false);
    posthog.register({ again: 1 });
    await settle();
    expect(traces().cookies).toEqual([`ph_${KEY}_posthog`]);
    b.done();
  });
});
