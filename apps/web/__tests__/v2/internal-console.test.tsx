/**
 * The support console's screens (CC-33 D2), rendered from plain view values: the actions' forms, the
 * Stripe link, and the orange element.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mechanismProblems } from '../security/route-mechanism';
import { parseSource } from '../security/route-source';
import { WEB_ROOT } from './_lib/tokens-css';
import { ConsoleAccountScreen } from '../../components/v2/screens/internal/ConsoleAccountScreen';
import { ConsoleSearchScreen } from '../../components/v2/screens/internal/ConsoleSearchScreen';
import type { Dossier } from '../../lib/v2/ops/console-store';
import { accountView } from '../../lib/v2/ops/console-view';

const A = 'a0000000-0000-4000-8000-000000000001';
const U = 'b0000000-0000-4000-8000-000000000001';
const S = 'c0000000-0000-4000-8000-000000000001';

const dossier = (customer: string | null): Dossier => ({
  account: {
    id: A,
    name: null,
    kind: 'personal',
    state: 'free',
    tier: 'free',
    trial_ends_at: null,
    past_due_since: null,
    state_history: [{ state: 'free', since: '2026-10-01T00:00:00.000Z' }],
    stripe_customer_id: customer,
    internal: false,
    created_at: '2026-10-01T00:00:00.000Z',
    deleted_at: null,
  },
  seats: [
    {
      id: 's1',
      user_id: U,
      role: 'owner',
      status: 'active',
      accepted_at: '2026-10-01T00:00:00.000Z',
      removed_at: null,
    },
  ],
  emails: { [U]: ['owner', 'example.com'].join('@') },
  sites: [{ id: S, host: 'one.example', paused_reason: null, removed_at: null }],
  checks: [
    {
      id: 'd0000000-0000-4000-8000-000000000001',
      site_id: S,
      status: 'failed',
      trigger: 'scheduled',
      failure_reason: 'reaped',
      queued_at: '2026-11-12T08:00:00.000Z',
      started_at: '2026-11-12T08:01:00.000Z',
      finished_at: '2026-11-12T08:31:00.000Z',
    },
  ],
  mail: [],
  rules: [],
  alerts: [],
  fixes: [],
  totals: { seats: 1, sites: 1, checks: 1, mail: 0, rules: 0, alerts: 0, fixes: 0 },
});

const count = (html: string, s: string) => html.split(s).length - 1;

describe('the account screen', () => {
  it('links a customer id to Stripe in a new tab with no referrer', () => {
    const html = renderToStaticMarkup(
      <ConsoleAccountScreen view={accountView(dossier('cus_Abc123'))} notice={null} />,
    );
    expect(html).toContain(
      '<a href="https://dashboard.stripe.com/customers/cus_Abc123" target="_blank" rel="noreferrer">cus_Abc123</a>',
    );
  });

  it('shows any other stored value as text', () => {
    const html = renderToStaticMarkup(
      <ConsoleAccountScreen view={accountView(dossier('cus_a/../x'))} notice={null} />,
    );
    expect(html).not.toContain('dashboard.stripe.com');
    expect(html).toContain('cus_a/../x');
  });

  it('each action is a POST form with a required reason, and the screen has no orange element', () => {
    const html = renderToStaticMarkup(
      <ConsoleAccountScreen view={accountView(dossier(null))} notice={null} />,
    );
    expect(count(html, 'method="post"')).toBe(2);
    expect(count(html, 'name="reason"')).toBe(2);
    expect(count(html, 'required=""')).toBe(2);
    expect(count(html, 'data-v2-primary')).toBe(0);
  });

  it('says under a section how many rows it does not show, and nothing when it shows them all', () => {
    const whole = renderToStaticMarkup(
      <ConsoleAccountScreen view={accountView(dossier(null))} notice={null} />,
    );
    expect(whole).not.toContain('more not shown');
    const d = dossier(null);
    const html = renderToStaticMarkup(
      <ConsoleAccountScreen
        view={accountView({ ...d, totals: { ...d.totals, sites: 4, checks: 21, fixes: 2 } })}
        notice={null}
      />,
    );
    expect(html).toMatch(/aria-label="Sites"[\s\S]*3 more not shown\./);
    expect(html).toContain('The checks and open fixes below are those of the sites shown.');
    expect(html).toMatch(/aria-label="Last 20 checks"[\s\S]*20 more not shown\./);
    expect(html).toMatch(/aria-label="Open fixes"[\s\S]*2 more not shown\./);
    expect(count(html, 'more not shown.')).toBe(3);
  });

  it('shows a notice as one line', () => {
    const html = renderToStaticMarkup(
      <ConsoleAccountScreen view={accountView(dossier(null))} notice="Re-run queued." />,
    );
    expect(html).toMatch(/<p class="[^"]*" role="status">Re-run queued\.<\/p>/);
    expect(count(html, 'role="status"')).toBe(1);
  });
});

describe('client analytics on the console', () => {
  it('each screen opts its content out of autocapture and masks it in a replay', () => {
    for (const html of [
      renderToStaticMarkup(<ConsoleSearchScreen results={null} nothingFound={false} />),
      renderToStaticMarkup(
        <ConsoleAccountScreen view={accountView(dossier(null))} notice={null} />,
      ),
    ]) {
      expect(html).toMatch(/<main class="[^"]*\bph-no-capture\b[^"]*" data-ph-mask="">/);
    }
  });
});

describe('the search screen', () => {
  it('posts the query, and has one orange element', () => {
    const html = renderToStaticMarkup(<ConsoleSearchScreen results={null} nothingFound={false} />);
    expect(html).toContain('action="/api/internal/search"');
    expect(count(html, 'data-v2-primary')).toBe(1);
  });
});

describe('every page under app/internal asks requireOperator before it reads anything', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = join(dir, e);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const pages = walk(join(WEB_ROOT, 'app', 'internal')).filter((f) => /\/page\.tsx?$/.test(f));

  it('finds the pages', () => {
    expect(pages.map((f) => relative(WEB_ROOT, f)).sort()).toEqual([
      'app/internal/accounts/[id]/page.tsx',
      'app/internal/page.tsx',
    ]);
  });

  it.each(pages.map((f) => [relative(WEB_ROOT, f), f]))('%s', (_rel, file) => {
    expect(
      mechanismProblems(parseSource(readFileSync(file, 'utf8'), 'page.tsx'), 'operator'),
    ).toEqual([]);
  });
});
