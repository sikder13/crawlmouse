/**
 * Trial ending (Final-TrialEnd) against values worked out by hand from bad-site, read at the
 * reminder: trial_ends_at 8 Nov 02:41Z less three days, 5 Nov 02:41Z, Wed 4 Nov 21:41 in Indiana
 * (EST). The trial began 25 Oct 02:41Z, Sat 24 Oct 22:41 (EDT). The fixture holds nothing after its
 * as_of, Fri 30 Oct 10:05Z, and nothing was scheduled between then and now.
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { trialEndView, trialEndViewer } from './trial-end';

const bad = fixture('bad-site');
const BAD = 'a0000000-0000-4000-8000-000000000001';
const view = () => trialEndView(bad, trialEndViewer(bad, BAD));

describe('the trial-ending moment', () => {
  it('is three days before the trial ends, at the same clock time, in the account’s zone', () => {
    expect(trialEndViewer(bad, BAD)).toEqual({ accountId: BAD, now: '2026-11-05T02:41:00.000Z' });
  });
});

describe('Trial ending, the header and banner', () => {
  it('counts the days left and names the last check', () => {
    const h = view().header;
    expect(h.title).toBe('Three days of Pro left');
    expect(h.line).toBe('Wed 4 Nov · 5 sites · last check Fri 30 Oct 06:02 · trial ends Sat 7 Nov');
    expect(h.actions.map((a) => [a.label, a.href, a.primary])).toEqual([
      ['Run an audit now', '/api/sites/50000000-0000-4000-8000-000000000001/checks', false],
    ]);
  });

  it('says the reminder went out today and what the missing card means', () => {
    const b = view().banner;
    expect(b.title).toBe("Pro ends Sat 7 Nov. Here is exactly what changes, and what doesn't.");
    expect(b.sub).toBe(
      'We sent this once, today, as promised. No card is on file, so nothing is charged either way.',
    );
    expect(b.keep).toMatchObject({ label: 'Keep Pro, $19 a month · add a card', primary: true });
    expect(b.end).toMatchObject({
      label: 'Let it end on Sat 7 Nov',
      href: '/dashboard',
      primary: false,
    });
  });

  it('leaves the plan to the page: the rail’s card has no Keep and no reminder promise', () => {
    expect(view().shell.trial).toMatchObject({
      left: '3 days left',
      note: 'No card on file. Nothing is charged unless you choose Pro.',
      keep: null,
    });
  });
});

describe('Trial ending, what stays and what pauses', () => {
  it('keeps the oldest primary site, the free three and the public link', () => {
    // The free three at the primary site's latest result (c…06), by rank: fix 1, fix 2, fix 0.
    expect(view().stays.map((r) => [r.what, r.how])).toEqual([
      ['example-outfitter.com', 'monthly checks, email if changed'],
      ['Every check, every audit, the evidence', 'kept'],
      ['Fixes 0, 1 and 2, the free three', 'packets stay open'],
      ['Public audit link', 'keeps working'],
      ['Alerts on example-outfitter.com', 'still sent by email, after each monthly check'],
    ]);
  });

  it('pauses the other three primary sites and the staging copy, and the Pro features the account uses', () => {
    // Open fixes at c…06 are 0–15; the free three aside, thirteen: 3 to 15.
    expect(view().pauses.map((r) => [r.what, r.how])).toEqual([
      [
        'nahltech.com, redbirdaviation.com and drivepei.ca',
        'no checks; history kept, nothing you can see deleted',
      ],
      ['staging.example-outfitter.dev', 'no deploy checks on Free; history kept'],
      ['Fixes 3–15, thirteen on Pro', 'listed, packets closed'],
      // Weekly schedules, the Slack integration, summitgear.co, three exports made.
      ['Weekly checks, Slack alerts, competitor, exports', 'off; email alerts continue'],
    ]);
  });
});

describe('Trial ending, what Pro did', () => {
  it('counts the window’s checks, changes and fixes by iterating them', () => {
    const p = view().did;
    expect([p.title, p.sub]).toEqual([
      'What Pro did for you in 11 days',
      'Sat 24 Oct to Wed 4 Nov',
    ]);
    expect(p.rows.map((r) => [r.label, r.value, r.detail])).toEqual([
      [
        'Checks run',
        '13',
        // The first audit finished at 02:34Z, seven minutes before the trial began: not counted.
        '5 on example-outfitter.com: Mon 26 Oct, Tue 27 Oct, the re-check Wed 28 Oct after fix 2, Thu 29 Oct and Fri 30 Oct · 8 across the other four sites',
      ],
      [
        'Changes caught',
        '3',
        'Claude-SearchBot and ClaudeBot blocked Fri 30 Oct, after robots.txt changed Thu 19:40 · nahltech.com: 3 orphan pages now linked',
      ],
      ['Fixes closed', '1', '/blog/* on nahltech.com, Fri 30 Oct · Technical SEO B 79 → B+ 84'],
      [
        'Fixes open with packets',
        '14',
        '3 stay open on Free; 11 close. 2 more open fixes have no packet.',
      ],
    ]);
  });
});

describe('Trial ending, the two choices', () => {
  it('words keeping Pro and letting it end from the prices, the gates and the sites', () => {
    const v = view();
    expect(v.keepText).toBe(
      '$19 a month, or $190 a year, charged on Sat 7 Nov and then monthly. Cancel any day from Settings, in two clicks; the account goes back to Free. Nothing you can see is deleted; evidence older than 90 days is condensed to headers and the parts of pages that changed. Stripe emails the receipts; they are also in Settings › Plan.',
    );
    expect(v.endText).toBe(
      'Nothing to do. On Sat 7 Nov the account is Free: example-outfitter.com keeps its monthly check and its three fixes. The other three sites pause with their history kept, and so does the staging copy; add Pro any time to resume them.',
    );
  });
});
