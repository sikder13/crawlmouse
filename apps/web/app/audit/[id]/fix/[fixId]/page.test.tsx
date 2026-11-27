/**
 * The fix page's route: the `?notice=` a form comes back with reaches the screen, as its code alone.
 * The audit reader is a fake; everything below it is the real page.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixesAsOf, fixture } from '../../../../../lib/v2/fixtures';
import { NOTICE_LINES } from '../../../../../lib/v2/copy/notices';
import type { CheckRead } from '../../../../../lib/v2/pipeline/public';

vi.mock('server-only', () => ({}));
// The pages read the seat's theme from the session (F-292); a visitor here has none.
vi.mock('@/lib/v2/account/session-theme', () => ({ sessionTheme: async () => null }));

const readAudit = vi.fn<(id: string) => Promise<CheckRead | null>>();
vi.mock('../../_lib/access', () => ({
  readAudit: (id: string) => readAudit(id),
  isReadableAudit: async () => true,
}));

const { default: AuditFixPage } = await import('./page');

const d = fixture('bad-site');
const check = d.checks.find((c) => fixesAsOf(d, c).some((f) => f.packet !== null))!;
const fix = fixesAsOf(d, check).find((f) => f.packet !== null)!;

/** The route's element is the async `FixPage`, which a static render cannot await, so it is called. */
async function page(query: Record<string, string>) {
  const route = (await AuditFixPage({
    params: Promise.resolve({ id: check.id, fixId: fix.id }),
    searchParams: Promise.resolve(query),
  })) as ReactElement<object, (props: object) => Promise<ReactElement>>;
  return renderToStaticMarkup(await route.type(route.props));
}

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  readAudit.mockResolvedValue({
    state: 'ready',
    checkId: check.id,
    host: 'example-outfitter.com',
    kept: true,
    plan: 'pro',
    dataset: d,
    map: null,
  } as unknown as CheckRead);
});
afterEach(() => vi.unstubAllEnvs());

describe('/audit/[id]/fix/[fixId], after the email form', () => {
  it('says what the form did', async () => {
    expect(await page({ notice: 'email_requested' })).toContain('data-v2-notice="email_requested"');
  });

  it('says nothing with no notice, or with one that is not ours', async () => {
    expect(await page({})).not.toContain('data-v2-notice');
    expect(await page({ notice: 'nonsense' })).not.toContain('data-v2-notice');
  });

  it('leaves out a retry time, which it has no account time zone to say', async () => {
    const markup = await page({ notice: 'rate_limited', next: '2026-11-24T10:00:00.000Z' });
    expect(markup).toContain('data-v2-notice="rate_limited"');
    expect(markup).toContain(NOTICE_LINES.rate_limited(null));
    expect(markup).not.toContain('Ask again from');
  });
});
