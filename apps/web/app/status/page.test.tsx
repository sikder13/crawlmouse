import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_EMAIL } from '../../components/v2/footer-links';
import { ANSWERING, healthReport } from '../../lib/v2/ops/health';
import StatusPage, { dynamic, metadata } from './page';

vi.mock('next/navigation', () => ({ usePathname: () => '/status' }));

/**
 * /status (CC-33 rulings, Q6): it shows what it measures and says what it does not. The one state it
 * reports is the website's, from /api/health's own logic, rendered on the request; any other word
 * that names a state of a service is a claim with nothing behind it.
 */

/** Words that name a state of a service. */
const STATE_WORDS = [
  'operational',
  'nominal',
  'up',
  'down',
  'degraded',
  'outage',
  'healthy',
  'answering',
  'online',
  'offline',
  'available',
  'unavailable',
  'working',
  'incident',
  'incidents',
];

const SHA = '0123456789abcdef0123456789abcdef01234567';
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = SHA;
});
afterEach(() => {
  if (saved === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = saved;
});

/** The page's <main>, as text, with the measured line marked out. */
function rendered() {
  const html = renderToStaticMarkup(<StatusPage />);
  const main = /<main\b[\s\S]*?<\/main>/.exec(html)?.[0] ?? '';
  // The measured line is one <div> holding no <div>.
  const measured = /<div [^>]*data-status-measured="website"[^>]*>([\s\S]*?)<\/div>/.exec(main);
  const text = (s: string) =>
    s
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;|&rsquo;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  return {
    main,
    measured: measured ? text(measured[1]!) : null,
    rest: text(measured ? main.replace(measured[0], ' ') : main),
  };
}

const wordsIn = (text: string) =>
  STATE_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));

describe('/status', () => {
  it('shows the website as answering, with the version and commit /api/health reports', () => {
    const { measured } = rendered();
    const report = healthReport();
    expect(measured).toContain(`Website: ${ANSWERING}`);
    expect(measured).toContain(report.version);
    expect(measured).toContain(SHA);
  });

  it('names no state outside the measured line', () => {
    const { measured, rest } = rendered();
    expect(wordsIn(measured ?? '')).toEqual([ANSWERING]);
    expect(wordsIn(rest)).toEqual([]);
  });

  it('says what it does not monitor, with the support address', () => {
    const { main, rest } = rendered();
    expect(rest).toContain('Audits, email and billing are not monitored on this page.');
    expect(main).toContain(`href="mailto:${SUPPORT_EMAIL}"`);
    expect(rest).not.toMatch(/status\.crawlmouse\.com/);
  });

  it('says so when the deploy has no commit', () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    expect(rendered().measured).toContain('commit not known');
  });

  it('is rendered on each request, and keeps v1’s title and canonical', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(metadata).toEqual({ title: 'Status', alternates: { canonical: '/status' } });
  });

  it('types the support address nowhere: it is imported', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain(SUPPORT_EMAIL);
  });
});
