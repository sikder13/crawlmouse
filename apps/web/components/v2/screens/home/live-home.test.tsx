/**
 * The v2 home as a route will mount it (CC-22b D10), and what `app/page.tsx` may reach: the v1
 * home's module imports no v2 module, statically or through `import()`, because a production
 * build links a v2 screen's stylesheets on each page whose module can reach it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/analytics/TrackView', () => ({
  TrackView: ({ event }: { event: string }) => <i data-event={event} />,
}));
vi.mock('@/components/analytics/ReferralCapture', () => ({
  ReferralCapture: () => <i data-referral="" />,
}));

const WEB = join(__dirname, '../../../..');

async function liveHome(door: boolean) {
  vi.resetModules();
  vi.stubEnv('V2_ACCOUNT_DOOR', door ? '1' : '');
  const { LiveHome } = await import('./LiveHome');
  return renderToStaticMarkup(<LiveHome />);
}

afterEach(() => vi.unstubAllEnvs());

describe('LiveHome', () => {
  it('is the Home screen with one heading, the home_viewed event and the referral capture', async () => {
    const markup = await liveHome(true);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('data-event="home_viewed"');
    expect(markup).toContain('data-referral=""');
    expect(markup.match(/Start the audit/g)!.length).toBeGreaterThanOrEqual(2);
    expect(markup.match(/data-v2-primary=""/g)).toHaveLength(1);
  }, 60_000);

  it('links nowhere that is not a page: no "#", and the plan buttons lead to Sign-up while the door is open', async () => {
    const open = await liveHome(true);
    expect(open).not.toContain('href="#"');
    expect(open.match(/href="\/signup"/g)).toHaveLength(2);
    expect(open).toContain('Create a free account');
    expect(open).not.toContain('Start a 14-day trial');
    const shut = await liveHome(false);
    expect(shut).not.toContain('href="#"');
    expect(shut).not.toContain('href="/signup"');
    expect(shut).not.toContain('Create a free account');
  }, 60_000);
});

describe('app/page.tsx', () => {
  const source = readFileSync(join(WEB, 'app/page.tsx'), 'utf8');

  it('reaches no v2 module, by import or by import()', () => {
    const reached = [...source.matchAll(/(?:from\s+|import\(\s*)'([^']+)'/g)].map((m) => m[1]!);
    expect(reached.length).toBeGreaterThan(5);
    expect(reached.filter((m) => /components\/v2|styles\/v2|lib\/v2/.test(m))).toEqual([]);
  });

  it('is the file main has', () => {
    const main = execFileSync('git', ['show', 'origin/main:apps/web/app/page.tsx'], {
      cwd: WEB,
      encoding: 'utf8',
    });
    expect(source).toBe(main);
  });
});
