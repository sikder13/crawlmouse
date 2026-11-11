import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeletionScreen } from '../../components/v2/screens/deletion/DeletionScreen';
import type { DeletionAnswer, DeletionPorts } from '../../lib/v2/account/deletion';
import {
  postDeletionLink,
  readDeletionLink,
  type DeletionFlow,
} from '../../lib/v2/account/deletion-link';
import { LINK_FLOWS } from '../../lib/v2/account/link-cookie';
import { newToken } from '../../lib/v2/account/tokens';
import { DELETE_COPY, REFUND_POLICY, RESTORE_COPY } from '../../lib/v2/copy/deletion';

vi.mock('server-only', () => ({}));

/**
 * The deletion's links, pages and POSTs (D4): the flag, GET renders and POST acts, the token only
 * from its cookie, and no token in a URL, a Location or the page's HTML.
 */

const WEB = join(__dirname, '../..');
const ORIGIN = 'https://crawlmouse.com';
const TOKEN = newToken();
const ports = () => ({}) as DeletionPorts;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const post = (flow: DeletionFlow, init: { cookie?: string; body?: string; type?: string }) =>
  new Request(`${ORIGIN}${LINK_FLOWS[flow].api}`, {
    method: 'POST',
    headers: {
      'content-type': init.type ?? 'application/x-www-form-urlencoded',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body ?? '',
  });

describe('postDeletionLink', () => {
  const ok = vi.fn(async (): Promise<DeletionAnswer> => ({ ok: true }));

  it('acts on the token from the flow’s cookie, sends a form back to its page, and clears the cookie', async () => {
    for (const flow of ['deleteConfirm', 'restore'] as const) {
      ok.mockClear();
      const res = await postDeletionLink(
        post(flow, { cookie: `other=1; ${LINK_FLOWS[flow].cookie}=${TOKEN}` }),
        ORIGIN,
        flow,
        ok,
        ports,
      );
      expect(ok).toHaveBeenCalledWith({}, TOKEN);
      expect(res.status).toBe(303);
      const location = res.headers.get('location')!;
      expect(location).toBe(
        `${ORIGIN}${LINK_FLOWS[flow].page}?result=${flow === 'deleteConfirm' ? 'deleted' : 'restored'}`,
      );
      expect(location).not.toContain(TOKEN);
      expect(res.headers.get('set-cookie')).toMatch(
        new RegExp(`^${LINK_FLOWS[flow].cookie}=; .*Max-Age=0`),
      );
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('a restore token in the confirm cookie’s place is not read: each flow takes its own cookie only', async () => {
    const act = vi.fn(async (): Promise<DeletionAnswer> => ({ ok: true }));
    const res = await postDeletionLink(
      post('deleteConfirm', { cookie: `${LINK_FLOWS.restore.cookie}=${TOKEN}` }),
      ORIGIN,
      'deleteConfirm',
      act,
      ports,
    );
    expect(act).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account/delete?result=invalid_link`);
  });

  it('ignores a token in the body: a field is refused, and nothing acts', async () => {
    const act = vi.fn(async (): Promise<DeletionAnswer> => ({ ok: true }));
    const res = await postDeletionLink(
      post('deleteConfirm', { body: `token=${TOKEN}` }),
      ORIGIN,
      'deleteConfirm',
      act,
      ports,
    );
    expect(res.status).toBe(400);
    expect(act).not.toHaveBeenCalled();
  });

  it('answers JSON with the refusal’s status, and keeps the cookie when the link can still be used', async () => {
    const res = await postDeletionLink(
      post('deleteConfirm', {
        cookie: `${LINK_FLOWS.deleteConfirm.cookie}=${TOKEN}`,
        type: 'application/json',
      }),
      ORIGIN,
      'deleteConfirm',
      async () => ({ ok: false, status: 409, code: 'others_seated' }),
      ports,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'others_seated' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('readDeletionLink', () => {
  it('reads nothing for a value that is not a token, and passes on no id of the person', async () => {
    const rpc = vi.fn(async () => ({
      ok: true,
      userId: 'u1',
      purgeAfter: null,
      accounts: [{ id: 'a1', host: 'x.example' }],
    })) as unknown as Parameters<typeof readDeletionLink>[0];
    expect(await readDeletionLink(rpc, 'deleteConfirm', 'not-a-token', new Date())).toEqual({
      ok: false,
      code: 'invalid_link',
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(await readDeletionLink(rpc, 'deleteConfirm', TOKEN, new Date())).toEqual({
      ok: true,
      purgeAfter: null,
      accounts: [{ id: 'a1', host: 'x.example' }],
    });
  });
});

describe('the pages', () => {
  const view = {
    ok: true as const,
    purgeAfter: '2026-11-17T10:00:00.000Z',
    accounts: [{ id: 'a1', host: 'shop.example' }],
  };

  it('the delete page names the accounts, posts no field to its API route, and says the published refund policy', () => {
    const html = renderToStaticMarkup(
      <DeletionScreen flow="deleteConfirm" view={{ ...view, purgeAfter: null }} />,
    );
    expect(html).toContain('shop.example');
    expect(html).toMatch(
      /<form (?=[^>]*method="post")(?=[^>]*action="\/api\/account\/delete\/confirm")/,
    );
    expect(html).not.toMatch(/<input/);
    expect(html).toContain(DELETE_COPY.button);
    expect(renderToStaticMarkup(<>{REFUND_POLICY}</>)).toBe(
      renderToStaticMarkup(<>{DELETE_COPY.money[1]}</>),
    );
    expect(html).toContain(renderToStaticMarkup(<>{REFUND_POLICY}</>));
  });

  it('the refund sentence is the Terms page’s own', () => {
    const terms = readFileSync(join(WEB, 'app/terms/page.tsx'), 'utf8')
      .replace(/&rsquo;/g, '’')
      .replace(/\s+/g, ' ');
    expect(terms).toContain(REFUND_POLICY);
  });

  it('the restore page posts to its API route and says until when', () => {
    const html = renderToStaticMarkup(<DeletionScreen flow="restore" view={view} />);
    expect(html).toMatch(/<form (?=[^>]*method="post")(?=[^>]*action="\/api\/account\/restore")/);
    expect(html).toContain('17 November 2026');
    expect(html).toContain(RESTORE_COPY.button);
  });

  it('with no usable link, the page has no form', () => {
    const html = renderToStaticMarkup(
      <DeletionScreen flow="restore" view={{ ok: false, code: 'window_closed' }} />,
    );
    expect(html).not.toContain('<form');
    expect(html).toContain('The restore window has ended');
  });
});

describe('the routes', () => {
  const ROUTES = {
    'account/delete/[token]': ['GET'],
    'account/restore/[token]': ['GET'],
    'api/account/delete/confirm': ['POST'],
    'api/account/restore': ['POST'],
  } as const;
  const load = (route: keyof typeof ROUTES): Promise<Record<string, unknown>> =>
    ({
      'account/delete/[token]': () => import('../../app/(account)/account/delete/[token]/route'),
      'account/restore/[token]': () => import('../../app/(account)/account/restore/[token]/route'),
      'api/account/delete/confirm': () => import('../../app/api/account/delete/confirm/route'),
      'api/account/restore': () => import('../../app/api/account/restore/route'),
    })[route]();

  it('the API routes take POST only (Next answers 405 to a GET), and the links GET only', async () => {
    for (const [route, methods] of Object.entries(ROUTES)) {
      const mod = await load(route as keyof typeof ROUTES);
      const exported = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(
        (m) => typeof mod[m] === 'function',
      );
      expect(`${route}:${exported.join(',')}`).toBe(`${route}:${methods.join(',')}`);
    }
  });

  it('each is a 404 with V2_CHECKS_PUBLIC unset', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    for (const [route, [method]] of Object.entries(ROUTES)) {
      const mod = (await load(route as keyof typeof ROUTES)) as Record<
        string,
        (req: Request, ctx: unknown) => Promise<Response>
      >;
      const res = await mod[method]!(
        new Request(`${ORIGIN}/${route}`, {
          method,
          headers: { cookie: `cm_link_delete=${TOKEN}` },
        }),
        { params: Promise.resolve({ token: TOKEN }) },
      );
      expect(`${route}:${res.status}`).toBe(`${route}:404`);
    }
  });

  it('the link lands its token in the cookie and redirects to a page URL without it', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', ORIGIN);
    const mod = await import('../../app/(account)/account/delete/[token]/route');
    const res = await mod.GET(new Request(`${ORIGIN}/account/delete/${TOKEN}`), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account/delete`);
    expect(res.headers.get('set-cookie')).toContain(`cm_link_delete=${TOKEN}`);
  });
});
