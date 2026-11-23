// @vitest-environment jsdom
/**
 * The site page's public link control (F-123): Create posts to the guarded mint route and reads the
 * page again, a refusal says why, and a preview posts nothing.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_COPY } from '../../../../lib/v2/copy/site';
import { LiveActions } from '../account/LiveActions';
import { PublicLinkControl } from './PublicLink';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COPY = SITE_COPY.publicLink;
const CHECK = '70000000-0000-4000-8000-000000000001';
const URL_ = 'https://crawlmouse.com/r/a-link';
const reload = vi.fn();

let root: Root;
let host: HTMLDivElement;

const answer = (status: number, body: unknown) =>
  vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));

const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === name) ?? null;

async function draw(mintCheckId: string | null, url: string | null = null, live = true) {
  const control = <PublicLinkControl link={{ url, mintCheckId }} open={null} />;
  await act(async () => root.render(live ? <LiveActions>{control}</LiveActions> : control));
}

async function click(name: string) {
  await act(async () => {
    button(name)!.click();
    await new Promise((done) => setTimeout(done, 0));
  });
}

beforeEach(() => {
  reload.mockClear();
  vi.stubGlobal('location', { ...window.location, reload });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('the public link control (F-123)', () => {
  it('Create posts the check to the mint route and reads the page again', async () => {
    const fetcher = answer(200, { slug: 'a-link', alreadyPublic: false });
    vi.stubGlobal('fetch', fetcher);
    await draw(CHECK);
    await click(COPY.create);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/reports/mint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkId: CHECK }),
    });
  });

  it.each([
    ['captcha_required', 429, COPY.capped],
    ['captcha_failed', 429, COPY.capped],
    ['check_partial', 409, COPY.notFinished],
    ['check_not_finished', 409, COPY.notFinished],
    ['auth_required', 401, COPY.signedOut],
    ['role_refused', 403, COPY.failed],
    ['could not mint', 500, COPY.failed],
  ])('a refusal of %s says so and does not reload', async (error, status, sentence) => {
    vi.stubGlobal('fetch', answer(status, { error }));
    await draw(CHECK);
    await click(COPY.create);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(sentence);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a second click while the first is in flight posts nothing more', async () => {
    let finish: (r: Response) => void = () => undefined;
    const fetcher = vi.fn(
      (_url: string, _init: RequestInit) => new Promise<Response>((done) => (finish = done)),
    );
    vi.stubGlobal('fetch', fetcher);
    await draw(CHECK);
    await click(COPY.create);
    await click(COPY.create);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => finish(new Response('{}', { status: 200 })));
  });

  it('a network failure says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('down'))),
    );
    await draw(CHECK);
    await click(COPY.create);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(COPY.failed);
  });

  it('with a link, offers Copy, and a new link only when the latest check has none', async () => {
    await draw(null, URL_);
    expect(button(COPY.copy)).not.toBeNull();
    expect(button(COPY.update)).toBeNull();
    await draw(CHECK, URL_);
    expect(button(COPY.update)).not.toBeNull();
  });

  it('on a preview, Create posts nothing', async () => {
    const fetcher = answer(200, {});
    vi.stubGlobal('fetch', fetcher);
    await draw(CHECK, null, false);
    await click(COPY.create);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
