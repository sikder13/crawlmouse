import type { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { postgrestOver } from '@/__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '@/__tests__/helpers/v2-check-tables';
import { hashToken, newToken } from '@/lib/v2/account/tokens';

// The two pages the email-change links land on, rendered from a real link row: what the button does,
// with the address masked, and never the token.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  cookies: new Map<string, string>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      h.cookies.has(name) ? { name, value: h.cookies.get(name)! } : undefined,
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => postgrestOver(h.db) }));

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
});
afterAll(async () => h.db.close());
beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  h.cookies.clear();
});
afterEach(() => vi.unstubAllEnvs());

let n = 0;
/** A live link of `kind`, moving `old` to `fresh`; returns its raw token. */
async function link(kind: 'email_change' | 'email_change_undo', old: string, fresh: string) {
  n += 1;
  const userId = await signUp(h.db, `page${n}@example.com`);
  const { accountId } = await personalAccount(h.db, userId);
  const raw = newToken();
  await h.db.query(
    `select public.issue_account_token($1, $2, $3, $4, $5, now() + interval '1 hour', $6, $7)`,
    [accountId, userId, kind, hashToken(raw), raw, fresh, old],
  );
  return raw;
}

const render = async (
  page: 'email' | 'email-undo',
  query: Record<string, string> = {},
): Promise<string> => {
  const mod = page === 'email' ? await import('./page') : await import('../email-undo/page');
  return renderToStaticMarkup(await mod.default({ searchParams: Promise.resolve(query) }));
};

describe('/account/email', () => {
  it('shows the new address masked and a form that posts no field, and no token', async () => {
    const raw = await link('email_change', 'olga@old.example', 'nina@new.example');
    h.cookies.set('cm_link_email', raw);
    const html = await render('email');
    expect(html).toContain('n…@new.example');
    expect(html).not.toContain('nina@new.example');
    expect(html).toMatch(/<form[^>]* action="\/api\/account\/email\/confirm" method="post">/);
    expect(html).not.toMatch(/<input/);
    expect(html).not.toContain(raw);
    expect(html).not.toContain(hashToken(raw));
  });

  it('calls an undo token in its cookie unusable', async () => {
    const raw = await link('email_change_undo', 'olga@old.example', 'nina@new.example');
    h.cookies.set('cm_link_email', raw);
    const html = await render('email');
    expect(html).toContain('This link has been used or has expired.');
    expect(html).not.toContain('<form');
  });

  it('shows the answer the POST sent back', async () => {
    expect(await render('email', { done: '1' })).toContain('Your sign-in address is changed.');
    expect(await render('email', { error: 'address_taken' })).toContain(
      'That address belongs to another Crawlmouse account.',
    );
  });

  it('is a 404 with the flag unset', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(render('email')).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
    await expect(render('email-undo')).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

describe('/account/email-undo', () => {
  it('shows the old address masked and a form to the undo route, and no token', async () => {
    const raw = await link('email_change_undo', 'olga@old.example', 'nina@new.example');
    h.cookies.set('cm_link_email_undo', raw);
    const html = await render('email-undo');
    expect(html).toContain('o…@old.example');
    expect(html).toMatch(/<form[^>]* action="\/api\/account\/email\/undo" method="post">/);
    expect(html).not.toContain(raw);
  });
});
