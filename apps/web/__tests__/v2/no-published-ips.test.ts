/**
 * "From published IPs" is not on the pages this step adds (CC-29 review r1, SEO 6; Q28): `/bot`
 * publishes no IP list, so the sentence the crawler tables carry says only that the user agents are
 * tagged, and links to `/bot`. The sweep reads the copy, view and screen modules CC-29 added (listed
 * here, so a file that moves fails the test rather than leaving it), and the three `/check` pages
 * as they are built. The older v2 screens that carry the phrase (the home, the result, the dashboard)
 * are outside this sweep, and so is `/bot`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECK_QUESTIONS } from '../../lib/v2/copy/check-pages';
import { checkPageView } from '../../lib/v2/view/check-pages';
import { WEB_ROOT } from './_lib/tokens-css';

const PHRASE = /published IPs/i;

/** The CC-29 modules a reader's words come from: copy, views, and each screen's folder. */
const SWEPT = [
  'lib/v2/copy/agencies.ts',
  'lib/v2/copy/agency-trial.ts',
  'lib/v2/copy/check-pages.ts',
  'lib/v2/copy/developers.ts',
  'lib/v2/copy/pricing.ts',
  'lib/v2/view/agencies.ts',
  'lib/v2/view/agency-trial.ts',
  'lib/v2/view/check-pages.ts',
  'lib/v2/view/developers.ts',
  'lib/v2/view/pricing.ts',
  'lib/v2/view/public-report.ts',
  'lib/v2/reports/build-snapshot.ts',
  'components/v2/screens/agencies',
  'components/v2/screens/agency-trial',
  'components/v2/screens/check',
  'components/v2/screens/developers',
  'components/v2/screens/pricing',
  'components/v2/screens/public-report',
];

/** Each source file under `rel` (a file, or a folder walked), tests excluded. */
function sources(rel: string): string[] {
  const abs = join(WEB_ROOT, rel);
  if (!statSync(abs).isDirectory()) return [rel];
  return readdirSync(abs).flatMap((name) => sources(join(rel, name)));
}

describe('no CC-29 page says "published IPs" (Q28)', () => {
  const files = SWEPT.flatMap((rel) => {
    expect(existsSync(join(WEB_ROOT, rel)), rel).toBe(true);
    return sources(rel).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  });

  it('reads more than the listed folders themselves', () => {
    expect(files.length).toBeGreaterThan(SWEPT.length);
  });

  it.each(files)('%s', (file) => {
    expect(readFileSync(join(WEB_ROOT, file), 'utf8')).not.toMatch(PHRASE);
  });

  it.each(CHECK_QUESTIONS)('/check/%s as built', (question) => {
    expect(JSON.stringify(checkPageView(question))).not.toMatch(PHRASE);
  });
});
