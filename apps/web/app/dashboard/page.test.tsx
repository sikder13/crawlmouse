/**
 * /dashboard behind V2_CHECKS_PUBLIC (CC-26b D1, R14). Off, the page is v1 exactly as on main: its
 * source is main's file with the flag branch added and nothing else changed, and the v2 module is
 * never loaded. On, the v2 module renders the page.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ v2Loaded: 0, v2Rendered: 0 }));

vi.mock('server-only', () => ({}));
vi.mock('./v2-dashboard', () => {
  h.v2Loaded += 1;
  return {
    default: async () => {
      h.v2Rendered += 1;
      return 'v2 dashboard';
    },
  };
});
// v1's first read: no signed-in user, which v1 answers with a redirect to /login.
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

import DashboardPage from './page';

const HERE = join(process.cwd(), 'app', 'dashboard');
const render = () => DashboardPage({ searchParams: Promise.resolve({}) });

/** sha256 of apps/web/app/dashboard/page.tsx on origin/main 607bb19a. */
const MAIN_SHA256 = '3c564084adaf59952d38a962ecd91a3ac87f54c710f482d4b3c084e2df4e4ce0';

/** The lines the flag branch adds, exactly; removing them must give main's file back. */
const ADDED = [
  "import { checksPublicEnabled } from '@/lib/auth/flags';\n",
  `  // V2_CHECKS_PUBLIC serves the v2 dashboard. It is imported here and nowhere else, so the v1 page
  // has no static import of it.
  if (checksPublicEnabled()) {
    const { default: V2Dashboard } = await import('./v2-dashboard');
    return <V2Dashboard />;
  }
`,
];

beforeEach(() => {
  h.v2Loaded = 0;
  h.v2Rendered = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('/dashboard with V2_CHECKS_PUBLIC off', () => {
  it('serves v1: its first step redirects a signed-out caller to /login, and v2 is not loaded', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining('/login') });
    expect(h.v2Loaded).toBe(0);
  });

  it('a value other than 1 is off', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', 'true');
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining('/login') });
    expect(h.v2Loaded).toBe(0);
  });

  it('the source is main’s file with only the flag branch added', () => {
    const source = readFileSync(join(HERE, 'page.tsx'), 'utf8');
    let v1 = source;
    for (const block of ADDED) {
      expect(v1.split(block)).toHaveLength(2);
      v1 = v1.replace(block, '');
    }
    expect(createHash('sha256').update(v1, 'utf8').digest('hex')).toBe(MAIN_SHA256);
  });

  it('the page imports the v2 module only dynamically, inside the branch', () => {
    const source = readFileSync(join(HERE, 'page.tsx'), 'utf8');
    const statics = source.match(/^import .+$/gm) ?? [];
    expect(statics.filter((l) => /v2|styles/.test(l))).toEqual([]);
    expect(source.match(/import\('\.\/v2-dashboard'\)/g)).toHaveLength(1);
  });
});

describe('/dashboard with V2_CHECKS_PUBLIC=1', () => {
  it('renders the v2 module and nothing of v1', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const out = await render();
    expect(h.v2Rendered).toBe(0); // rendered by React, not called by the page
    expect(out).toMatchObject({ props: {} });
    expect(typeof (out as { type: unknown }).type).toBe('function');
    expect(await (out as { type: () => Promise<string> }).type()).toBe('v2 dashboard');
    expect(h.v2Loaded).toBe(1);
  });
});
