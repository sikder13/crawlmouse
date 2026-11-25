// @vitest-environment jsdom
/**
 * The Branding card's form (V2R register row 24): Save posts the brand name and the chosen logo as
 * multipart to the brand route, with the account in its query string; each refusal the route
 * answers with is said under the field it is about, or under Save; a preview posts nothing.
 */
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../../../../lib/v2/fixtures';
import { settingsView } from '../../../../lib/v2/view/settings';
import type { BrandingCardView } from '../../../../lib/v2/view/brand-card';
import { LiveActions } from '../account/LiveActions';
import { BrandingCard } from './BrandingCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT = 'a0000000-0000-4000-8000-0000000000c9';
const d = fixture('challenged-site');
const view: BrandingCardView = settingsView(d, { accountId: ACCOUNT, now: d.as_of }).branding!;

const NAME_RULE =
  'Use 1 to 60 characters, with no @, colon or slash, no dot followed by another character, and no number of 7 digits or more.';

let root: Root;
/** Calls to URL.createObjectURL: the card must never make one (a chosen file never reaches src). */
let objectUrls = 0;
const STORED = 'https://ref.supabase.co/storage/v1/object/public/report-logos/agency/x/a.png';
let host: HTMLDivElement;

const answer = (status: number, body: unknown) =>
  vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));

const $ = <T extends Element>(sel: string) => host.querySelector<T>(sel);

async function draw(live = true) {
  const card = <BrandingCard view={view} />;
  await act(async () => root.render(live ? <LiveActions>{card}</LiveActions> : card));
}

function choose(file: File | null) {
  Object.defineProperty($<HTMLInputElement>('#brand-logo')!, 'files', {
    configurable: true,
    value: file === null ? [] : [file],
  });
}

async function save(name = 'Acme Studio') {
  $<HTMLInputElement>('#brand-name')!.value = name;
  await act(async () => {
    $<HTMLButtonElement>('button[type="submit"]')!.click();
    await new Promise((done) => setTimeout(done, 0));
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  objectUrls = 0;
  URL.createObjectURL = () => `blob:logo-${++objectUrls}`;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('Save', () => {
  it('posts agencyName and logo as multipart to /api/agency/brand?account=<id>', async () => {
    const fetcher = answer(200, { agencyName: 'Acme Studio', logoPath: 'agency/x/abc.png' });
    vi.stubGlobal('fetch', fetcher);
    await draw();
    const logo = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    choose(logo);
    await save('Acme Studio');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`/api/agency/brand?account=${ACCOUNT}`);
    expect(init.method).toBe('POST');
    // A FormData body: the browser writes the multipart boundary, so no content-type is set here.
    expect(init.headers).toBeUndefined();
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()].sort()).toEqual(['agencyName', 'logo']);
    expect(body.get('agencyName')).toBe('Acme Studio');
    expect((body.get('logo') as File).name).toBe('logo.png');
    expect(body.get('accountId')).toBeNull();
  });

  it('sends the name alone when no file is chosen', async () => {
    const fetcher = answer(200, { agencyName: 'Acme Studio', logoPath: null });
    vi.stubGlobal('fetch', fetcher);
    await draw();
    choose(null);
    await save();
    const body = fetcher.mock.calls[0]![1].body as FormData;
    expect([...body.keys()]).toEqual(['agencyName']);
  });

  it('says it saved, shows the stored name and the stored logo from the answer', async () => {
    vi.stubGlobal(
      'fetch',
      answer(200, { agencyName: 'Acme Studio', logoPath: 'agency/x/a.png', logoUrl: STORED }),
    );
    await draw();
    choose(new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' }));
    await save('  Acme Studio  ');
    expect($('[role="status"]')!.textContent).toBe('Branding saved.');
    expect($<HTMLInputElement>('#brand-name')!.value).toBe('Acme Studio');
    const img = $<HTMLImageElement>('img')!;
    expect(img.getAttribute('src')).toBe(STORED);
    expect(img.getAttribute('src')).not.toMatch(/^blob:/);
    expect(img.getAttribute('alt')).toBe('Acme Studio logo');
    expect(objectUrls).toBe(0);
  });

  it('sends an empty file when one is chosen, and says the route’s refusal of it', async () => {
    const fetcher = answer(400, { code: 'invalid_logo', reason: 'empty' });
    vi.stubGlobal('fetch', fetcher);
    await draw();
    choose(new File([], 'blank.png', { type: 'image/png' }));
    await save();
    const body = fetcher.mock.calls[0]![1].body as FormData;
    expect([...body.keys()].sort()).toEqual(['agencyName', 'logo']);
    expect((body.get('logo') as File).size).toBe(0);
    expect($('#brand-logo-error')!.textContent).toBe('That file is empty. Choose an image.');
    expect($('[role="status"]')!.textContent).toBe('');
  });

  it('a name-only save shows the answer’s stored logo under the saved name', async () => {
    vi.stubGlobal(
      'fetch',
      answer(200, { agencyName: 'Renamed Co', logoPath: 'agency/x/a.png', logoUrl: STORED }),
    );
    await draw();
    choose(null);
    await save('Renamed Co');
    const img = $<HTMLImageElement>('img')!;
    expect(img.getAttribute('src')).toBe(STORED);
    expect(img.getAttribute('alt')).toBe('Renamed Co logo');
    expect(objectUrls).toBe(0);
  });

  it('a stored logo the answer gives no URL for keeps what is shown, and says to reload', async () => {
    await draw();
    const before = $<HTMLImageElement>('img')!.getAttribute('src');
    expect(before).toBe(view.logo.current!.src);
    vi.stubGlobal(
      'fetch',
      answer(200, { agencyName: 'Acme', logoPath: 'agency/x/a.png', logoUrl: null }),
    );
    choose(new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' }));
    await save('Acme');
    expect($('[role="status"]')!.textContent).toBe(
      'Branding saved. The logo shows here after a reload.',
    );
    expect($<HTMLImageElement>('img')!.getAttribute('src')).toBe(before);
    expect($<HTMLImageElement>('img')!.getAttribute('alt')).toBe('Acme logo');
    expect(objectUrls).toBe(0);
  });

  it('no stored logo in the answer shows "No logo yet"', async () => {
    vi.stubGlobal('fetch', answer(200, { agencyName: 'Acme', logoPath: null, logoUrl: null }));
    await draw();
    await save('Acme');
    expect($('img')).toBeNull();
    expect(host.textContent).toContain('No logo yet');
    expect($('[role="status"]')!.textContent).toBe('Branding saved.');
  });

  it('never shows a logoUrl that is not https', async () => {
    vi.stubGlobal(
      'fetch',
      answer(200, {
        agencyName: 'Acme',
        logoPath: 'agency/x/a.png',
        logoUrl: 'javascript:alert(1)',
      }),
    );
    await draw();
    await save('Acme');
    expect($<HTMLImageElement>('img')!.getAttribute('src')).toBe(view.logo.current!.src);
  });

  it('a preview posts nothing', async () => {
    const fetcher = answer(200, {});
    vi.stubGlobal('fetch', fetcher);
    await draw(false);
    await save();
    expect(fetcher).not.toHaveBeenCalled();
    expect($('[role="status"]')!.textContent).toBe('');
  });
});

describe('each refusal the route answers with', () => {
  it('400 invalid_name shows the name rule under the name, tied to it', async () => {
    vi.stubGlobal('fetch', answer(400, { code: 'invalid_name', message: NAME_RULE }));
    await draw();
    await save('a@b');
    const input = $<HTMLInputElement>('#brand-name')!;
    expect($('#brand-name-error')!.textContent).toBe(NAME_RULE);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('brand-name-hint brand-name-error');
    expect(document.activeElement).toBe(input);
    expect($('[role="status"]')!.textContent).toBe('');
  });

  it.each([
    ['empty', 'That file is empty. Choose an image.'],
    ['too_large', 'That logo is over 200 KB. Choose a smaller file.'],
    ['unsupported_type', 'That file is not a PNG, JPEG or WebP image.'],
    ['malformed', 'That image could not be read. Export it again and choose the new file.'],
    ['bad_dimensions', 'That logo must be between 1 and 4,096 pixels on each side.'],
    ['some_new_reason', 'That logo could not be saved. Choose another image.'],
  ])('400 invalid_logo %s says so under the logo', async (reason, sentence) => {
    vi.stubGlobal('fetch', answer(400, { code: 'invalid_logo', reason }));
    await draw();
    await save();
    const input = $<HTMLInputElement>('#brand-logo')!;
    expect($('#brand-logo-error')!.textContent).toBe(sentence);
    expect(input.getAttribute('aria-describedby')).toBe('brand-logo-hint brand-logo-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect($('#brand-name-error')).toBeNull();
  });

  it('413 too_large is the logo’s size', async () => {
    vi.stubGlobal('fetch', answer(413, { code: 'too_large' }));
    await draw();
    await save();
    expect($('#brand-logo-error')!.textContent).toBe(
      'That logo is over 200 KB. Choose a smaller file.',
    );
  });

  it('429 rate_limited says how often it can be saved', async () => {
    vi.stubGlobal('fetch', answer(429, { code: 'rate_limited' }));
    await draw();
    await save();
    expect($('[role="status"]')!.textContent).toBe(
      'Branding can be saved five times an hour. Try again in an hour.',
    );
    expect($('#brand-name-error')).toBeNull();
    expect($('#brand-logo-error')).toBeNull();
  });

  it('401 auth_required says the session ended, with a sign-in link back to Settings', async () => {
    vi.stubGlobal('fetch', answer(401, { code: 'auth_required' }));
    await draw();
    await save();
    const line = $('[role="status"]')!;
    expect(line.textContent).toBe('Your session has ended. Sign in again, then save. Sign in');
    expect(line.querySelector('a')!.getAttribute('href')).toBe('/login?next=/settings');
  });

  it.each([
    [
      403,
      'role_refused',
      'Your role on this account cannot set branding. The owner or an account manager can.',
    ],
    [403, 'upgrade_required', 'This account’s plan does not include branding.'],
    [404, 'not_found', 'Branding is not available right now.'],
  ])('%i %s says why', async (status, code, sentence) => {
    vi.stubGlobal('fetch', answer(status, { code }));
    await draw();
    await save();
    expect($('[role="status"]')!.textContent).toBe(sentence);
    expect($('[role="status"] a')).toBeNull();
  });

  it.each([
    [500, { code: 'save_failed' }],
    [500, { code: 'upload_failed' }],
    [503, { code: 'unavailable' }],
    [403, { code: 'something_else' }],
    [200, {}],
  ])('%i %j is the generic failure', async (status, body) => {
    vi.stubGlobal('fetch', answer(status, body));
    await draw();
    await save();
    expect($('[role="status"]')!.textContent).toBe(
      'Branding was not saved. Try again in a minute.',
    );
  });

  it('a network failure is the generic failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    await draw();
    await save();
    expect($('[role="status"]')!.textContent).toBe(
      'Branding was not saved. Try again in a minute.',
    );
  });
});

describe('before the page has hydrated', () => {
  it('the form has no action or method and Save is disabled, so nothing posts natively', () => {
    const doc = new JSDOM(renderToStaticMarkup(<BrandingCard view={view} />)).window.document;
    const form = doc.querySelector('form')!;
    expect(form.hasAttribute('action')).toBe(false);
    expect(form.hasAttribute('method')).toBe(false);
    expect(doc.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it('Save is enabled once hydrated', async () => {
    await draw();
    expect($<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
});
