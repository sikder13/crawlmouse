/**
 * The Browser Run section of docs/ops/worker-runbook.md is written by hand; this holds its numbers and
 * names to the code's, so a change to a limit, a price or a variable fails here until the runbook says
 * the same.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAP_ENV } from './budget.js';
import { BROWSER_RUN, ENV, REQUEST_TIMEOUT_MS } from './client.js';
import {
  IN_FLIGHT_ENV,
  RENDER_IN_FLIGHT_DEFAULT,
  RENDER_IN_FLIGHT_MAX,
  RENDER_RETRY,
  RESERVE_PER_RENDER_MS,
} from './run.js';

const RUNBOOK = readFileSync(
  new URL('../../../../../docs/ops/worker-runbook.md', import.meta.url),
  'utf8',
);
const HEADING = '## Browser Run: the render token, limits and cost';
const section = (() => {
  const start = RUNBOOK.indexOf(HEADING);
  const end = RUNBOOK.indexOf('\n## ', start + HEADING.length);
  // Whitespace folded to one space, so line wrapping neither breaks nor satisfies a check.
  return start < 0 ? '' : RUNBOOK.slice(start, end < 0 ? undefined : end).replace(/\s+/g, ' ');
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
    ['the request rate', `${BROWSER_RUN.requests_per_second} Quick Actions requests per second`],
    ['the browser timeout', `${BROWSER_RUN.browser_timeout_s} s without a command`],
    ['the price', `$${BROWSER_RUN.usd_per_browser_hour} per browser-hour`],
    ['the included hours', `${BROWSER_RUN.included_browser_hours_per_month} browser-hours a month`],
    ['the browser-time header', BROWSER_RUN.browser_ms_header],
    ['the in-flight variable', IN_FLIGHT_ENV],
    [
      'the in-flight limit',
      `at most ${RENDER_IN_FLIGHT_DEFAULT} requests open per check unless set, up to ${RENDER_IN_FLIGHT_MAX}`,
    ],
    ['the longest wait taken', `asked to wait longer than ${RENDER_RETRY.max_ms / 1000} s`],
    [
      'the Free request rate',
      `one Quick Actions request every ${BROWSER_RUN.free_request_every_s} s`,
    ],
    ['the Free browser time', `${BROWSER_RUN.free_browser_minutes_per_day} browser-minutes a day`],
    ['the plan production needs', 'Production rendering needs Workers Paid'],
    ['the tries', `after ${RENDER_RETRY.attempts} tries`],
    ['the backoff start', `backs off from ${RENDER_RETRY.base_ms / 1000} s`],
    ['the request timeout', `the ${REQUEST_TIMEOUT_MS / 1000} s request timeout`],
    ['a page’s reservation', `A page reserves ${(2 * RESERVE_PER_RENDER_MS) / 1000} s`],
    [
      'the smallest cap that renders',
      `a cap under ${(2 * RESERVE_PER_RENDER_MS) / 1000} renders nothing`,
    ],
    [
      'the check’s allowance',
      `or ${(2 * RESERVE_PER_RENDER_MS) / 1000} s for each page it sampled, whichever is less`,
    ],
    ['the one ask of the day’s budget', "asks the day's budget once, before any page"],
    ['the rule on killing processes', 'Only ever kill processes started from your own worktree.'],
  ])('names %s as the code has it', (_name, text) => {
    expect(section).toContain(text);
  });

  it('works out its example cost from the price', () => {
    // 200 browser-seconds at the hourly price, to three decimal places.
    const usd = ((200 / 3600) * BROWSER_RUN.usd_per_browser_hour).toFixed(3);
    expect(section).toContain(`200 counted browser-seconds is about $${usd}`);
  });
});
