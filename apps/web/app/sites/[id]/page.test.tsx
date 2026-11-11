/**
 * /sites/[id] (CC-26b D8). Run on PGlite with every migration applied: the session client is the
 * PostgREST stand-in as the signed-in user (row security applies), the service role is the stand-in
 * without one, and the paged reader is the pipeline's PGlite reader.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, CrawlPage } from '@crawlmouse/types/v2';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { pageVantage, persistBuiltCheck } from '../../../lib/v2/pipeline/persist';
import {
  pgliteCheckReader,
  pglitePersistDb,
  seedRunningCheck,
} from '../../../lib/v2/pipeline/test-support/pglite';

const h = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    ...postgrestOver(h.db as PGlite, h.userId ? { as: { userId: h.userId } } : {}),
    auth: {
      getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null }, error: null }),
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => postgrestOver(h.db as PGlite) }));
vi.mock('@/lib/v2/pipeline/load', () => ({
  supabaseCheckReader: () => pgliteCheckReader(h.db as PGlite),
}));

import { FirstCheckScreen } from '@/components/v2/screens/site/FirstCheckScreen';
import { SiteScreen } from '@/components/v2/screens/site/SiteScreen';
import SitePage from './page';

let ownerId: string;
let strangerId: string;
let kept: string;
let empty: string;
let removed: string;
let theirs: string;

const crawlRows = (batches: readonly unknown[]): CrawlPage[] =>
  (batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : []));

beforeAll(async () => {
  const db = await freshDb();
  await applyAllMigrations(db);
  h.db = db;
  ownerId = await signUp(db, `owner-${randomUUID().slice(0, 8)}@example.com`);
  const { accountId } = await personalAccount(db, ownerId);
  const input = recordedBuild();
  kept = input.site.id;
  await seedRunningCheck(db, { ...input.site, account_id: accountId }, input.check);
  await persistBuiltCheck(pglitePersistDb(db), {
    built: buildCheck(input),
    vantage: pageVantage(crawlRows(input.batches)),
    map_path: null,
    // A site's first check: its build read no fixes.
    read: [],
  });
  empty = randomUUID();
  removed = randomUUID();
  await db.query(
    `insert into public.sites (id, account_id, host) values ($1, $2, 'second.example')`,
    [empty, accountId],
  );
  await db.query(
    `insert into public.sites (id, account_id, host, removed_at) values ($1, $2, 'gone.example', now())`,
    [removed, accountId],
  );
  strangerId = await signUp(db, `stranger-${randomUUID().slice(0, 8)}@example.com`);
  const other = await personalAccount(db, strangerId);
  theirs = randomUUID();
  await db.query(
    `insert into public.sites (id, account_id, host) values ($1, $2, 'theirs.example')`,
    [theirs, other.accountId],
  );
}, 300_000);

afterEach(() => vi.unstubAllEnvs());

const open = (id: string, userId: string | null = ownerId) => {
  h.userId = userId;
  return SitePage({ params: Promise.resolve({ id }) });
};
const notFoundError = { digest: expect.stringMatching(/404/) };
const children = (el: unknown) => (el as ReactElement<{ children: ReactElement }>).props.children;

describe('/sites/[id] with V2_CHECKS_PUBLIC off', () => {
  it('is a 404 even for the owner of the site', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(open(kept)).rejects.toMatchObject(notFoundError);
  });
});

describe('/sites/[id] with V2_CHECKS_PUBLIC=1', () => {
  it('sends a signed-out caller to sign in', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    await expect(open(kept, null)).rejects.toMatchObject({
      digest: expect.stringContaining('/login'),
    });
  });

  it('renders a site with a result as the site screen', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const page = children(await open(kept));
    expect(page.type).toBe(SiteScreen);
  });

  it('renders a site with no check yet as the first-check screen', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const page = children(await open(empty));
    expect(page.type).toBe(FirstCheckScreen);
  });

  it('another account’s site, a removed site, a missing site and a malformed id are each a 404', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    await expect(open(theirs)).rejects.toMatchObject(notFoundError);
    await expect(open(removed)).rejects.toMatchObject(notFoundError);
    await expect(open(randomUUID())).rejects.toMatchObject(notFoundError);
    await expect(open('not-an-id')).rejects.toMatchObject(notFoundError);
  });

  it('the other account’s owner opens their own site and not this one', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(children(await open(theirs, strangerId)).type).toBe(FirstCheckScreen);
    await expect(open(kept, strangerId)).rejects.toMatchObject(notFoundError);
  });
});
