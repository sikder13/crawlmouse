/**
 * The Browser Run section of docs/ops/worker-runbook.md is written by hand; this holds its numbers and
 * names to the code's, so a change to a limit, a price or a variable fails here until the runbook says
 * the same.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAP_ENV } from './budget.js';
import { BROWSER_RUN, ENV } from './client.js';
import { RENDER_IN_FLIGHT } from './run.js';

const RUNBOOK = readFileSync(
  new URL('../../../../../docs/ops/worker-runbook.md', import.meta.url),
  'utf8',
);
const HEADING = '## Browser Run: the render token, limits and cost';
const section = (() => {
  const start = RUNBOOK.indexOf(HEADING);
  const end = RUNBOOK.indexOf('\n## ', start + HEADING.length);
  return start < 0 ? '' : RUNBOOK.slice(start, end < 0 ? undefined : end);
})();

describe('the runbook’s Browser Run section', () => {
  it('exists', () => {
    expect(section.length).toBeGreaterThan(HEADING.length);
  });

  it.each([
    ['the account variable', ENV.account],
    ['the token variable', ENV.token],
    ['the per-check cap', CAP_ENV.perCheck],
    ['the per-day cap', CAP_ENV.perDay],
    ['the date the limits page was updated', BROWSER_RUN.limits_updated],
    ['the date it was read', BROWSER_RUN.read_on],
    ['the request rate', `${BROWSER_RUN.requests_per_second} Quick\nActions requests per second`],
    ['the browser timeout', `${BROWSER_RUN.browser_timeout_s} s without a command`],
    ['the price', `$${BROWSER_RUN.usd_per_browser_hour} per browser-hour`],
    ['the included hours', `${BROWSER_RUN.included_browser_hours_per_month} browser-hours a month`],
    ['the browser-time header', BROWSER_RUN.browser_ms_header],
    ['the in-flight limit', `at most ${RENDER_IN_FLIGHT} requests open`],
  ])('names %s as the code has it', (_name, text) => {
    expect(section).toContain(text);
  });

  it('works out its example cost from the price', () => {
    // 200 browser-seconds at the hourly price, to three decimal places.
    const usd = ((200 / 3600) * BROWSER_RUN.usd_per_browser_hour).toFixed(3);
    expect(section).toContain(`200\nbrowser-seconds costs about $${usd}`);
  });
});
