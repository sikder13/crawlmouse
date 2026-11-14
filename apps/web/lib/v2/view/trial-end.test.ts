/**
 * Trial ending (Final-TrialEnd) against values worked out by hand from bad-site, read at the
 * reminder: trial_ends_at 8 Nov 02:41Z less three days, 5 Nov 02:41Z, Wed 4 Nov 21:41 in Indiana
 * (EST). The trial began 25 Oct 02:41Z, Sat 24 Oct 22:41 (EDT). The reading is after the fixture's
 * as_of, Fri 30 Oct 10:05Z; SPEC 27 renders what the fixture holds between the two.
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

  it('says when the reminder is due, and what the missing card means', () => {
    const b = view().banner;
    expect(b.title).toBe("Pro ends Sat 7 Nov. Here is exactly what changes, and what doesn't.");
    expect(b.sub).toBe(
      'The reminder is due once, on Wed 4 Nov. No card is on file, so nothing is charged either way.',
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
      [
        'Every check, every audit, the evidence',
        'kept; evidence older than 90 days is condensed to headers and the parts of pages that changed',
      ],
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
      // Fixes 14 and 15 have no packet, so eleven packets close.
      ['Fixes 3–15, thirteen on Pro', 'listed, 11 packets closed'],
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
        '5 on example-outfitter.com: Mon 26 Oct, Tue 27 Oct, the re-check Wed 28 Oct after fix 2, Thu 29 Oct and Fri 30 Oct · 8 across the other three sites and the staging copy',
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
    expect(v.keepTitle).toBe('If you keep Pro');
    expect(v.keepText).toBe(
      '$19 a month, or $190 a year, charged when you choose it and then each month or year. Cancel any day from Settings, in two clicks; the account goes back to Free. Nothing you can see is deleted; evidence older than 90 days is condensed to headers and the parts of pages that changed. Stripe emails the receipts; they are also in Settings › Plan.',
    );
    expect(v.endText).toBe(
      'Nothing to do. On Sat 7 Nov the account is Free: example-outfitter.com keeps its monthly check and its three fixes. The other three sites pause with their history kept, and so does the staging copy; add Pro any time to resume them.',
    );
  });
});

describe('Trial ending, on a trial with a card (Kestrel’s Agency trial, challenged-site)', () => {
  // Kestrel's trial ends 16 Nov 11:57Z, Mon 16 Nov in New York, with card 4242 on file. This reads
  // the rule, not a preview: the fixture holds nothing for Kestrel after its as_of.
  const ch = fixture('challenged-site');
  const v = () => trialEndView(ch, trialEndViewer(ch, 'a0000000-0000-4000-8000-0000000000ca'));

  it('says the card is charged unless the trial is cancelled, and offers the cancel, not a checkout', () => {
    const t = v();
    expect(t.header.title).toBe('Three days of Agency left');
    expect(t.banner.sub).toMatch(
      /The card ending 4242 is charged on Mon 16 Nov unless you cancel\.$/,
    );
    expect(t.banner.keep).toBeNull();
    expect(t.banner.end).toMatchObject({
      label: 'Cancel before Mon 16 Nov',
      href: '/settings/plan',
    });
    expect(t.pausesTitle).toBe('Pauses, until Agency');
  });

  it('words doing nothing and cancelling at the Agency price', () => {
    const t = v();
    expect(t.keepTitle).toBe('If you do nothing');
    expect(t.keepText).toMatch(
      /^The card ending 4242 is charged \$99 on Mon 16 Nov, then each month\. /,
    );
    expect(t.endTitle).toBe('If you cancel');
    expect(t.endText).toBe(
      'Cancel before Mon 16 Nov from Settings › Plan, in two clicks, and on Mon 16 Nov the account is Free: pinecrest.example keeps its monthly check.',
    );
  });
});

describe('Trial ending, the window’s edges', () => {
  it('starts at the current trial, not at the account’s first state', () => {
    // The same account with a Free state before its trial: the first audit (finished 02:34Z on
    // 25 Oct, before the trial's 02:41Z) stays outside the window.
    const a = bad.accounts.find((x) => x.id === BAD)!;
    const d = {
      ...bad,
      accounts: bad.accounts.map((x) =>
        x.id === BAD
          ? {
              ...a,
              state_history: [
                { state: 'free' as const, since: '2026-10-24T00:00:00Z' },
                ...a.state_history,
              ],
            }
          : x,
      ),
    };
    expect(trialEndView(d, trialEndViewer(d, BAD)).did.rows[0]!.value).toBe('13');
  });

  it('counts as closed only a resolved change that names its fix', () => {
    const d = {
      ...bad,
      changes: bad.changes.map((c) =>
        c.id === '90000000-0000-4000-8000-000000000005' ? { ...c, fix_id: null } : c,
      ),
    };
    const row = trialEndView(d, trialEndViewer(d, BAD)).did.rows[2]!;
    expect([row.value, row.detail]).toEqual(['0', 'none']);
  });
});

describe('Trial ending, the card decides, not the plan', () => {
  const withCard = (d: ReturnType<typeof fixture>, id: string, card: string | null) => ({
    ...d,
    accounts: d.accounts.map((a) => (a.id === id ? { ...a, card_last4: card } : a)),
  });
  /** A card on file, read by a seat that is not the owner: no digits, `card_on_file` (Q25). */
  const withheld = (d: ReturnType<typeof fixture>, id: string) => ({
    ...d,
    accounts: d.accounts.map((a) =>
      a.id === id ? { ...a, card_last4: null, card_on_file: true } : a,
    ),
  });

  it('a Pro trial with a card: no checkout, a cancel, “If you do nothing”', () => {
    const d = withCard(bad, BAD, '4242');
    const t = trialEndView(d, trialEndViewer(d, BAD));
    expect(t.banner.keep).toBeNull();
    expect(t.banner.end).toMatchObject({
      label: 'Cancel before Sat 7 Nov',
      href: '/settings/plan',
    });
    expect([t.keepTitle, t.endTitle]).toEqual(['If you do nothing', 'If you cancel']);
    expect(t.keepText).toMatch(
      /^The card ending 4242 is charged \$19 on Sat 7 Nov, then each month\. /,
    );
  });

  it('a card trial read by a seat that is not the owner: the card trial’s actions, and the owner manages the card (Q25)', () => {
    const d = withheld(bad, BAD);
    const t = trialEndView(d, trialEndViewer(d, BAD));
    expect(t.banner.keep).toBeNull();
    expect([t.keepTitle, t.endTitle]).toEqual(['If you do nothing', 'If you cancel']);
    expect(t.keepText).toMatch(/^Managed by the account owner\. /);
    expect(JSON.stringify(t)).not.toMatch(/card ending/);
  });

  it('an Agency trial with no card: the checkout, and letting it end', () => {
    const ch = fixture('challenged-site');
    const K = 'a0000000-0000-4000-8000-0000000000ca';
    const d = withCard(ch, K, null);
    const t = trialEndView(d, trialEndViewer(d, K));
    expect(t.banner.keep).toMatchObject({
      label: 'Keep Agency, $99 a month · add a card',
      primary: true,
    });
    expect(t.banner.end).toMatchObject({ label: 'Let it end on Mon 16 Nov', href: '/dashboard' });
    expect([t.keepTitle, t.endTitle]).toEqual(['If you keep Agency', 'If you let it end']);
  });
});

describe('Trial ending, a card trial billed yearly, and the counts when nothing is open', () => {
  const ch = fixture('challenged-site');
  const K = 'a0000000-0000-4000-8000-0000000000ca';

  it('charges the yearly price, then each year', () => {
    const d = {
      ...ch,
      accounts: ch.accounts.map((a) => (a.id === K ? { ...a, billing_period_months: 12 } : a)),
    };
    expect(trialEndView(d, trialEndViewer(d, K)).keepText).toMatch(
      /^The card ending 4242 is charged \$990 on Mon 16 Nov, then each year\. /,
    );
  });

  it('on Kestrel, with no finished check and no alert rule: “none”, and nothing sent by email', () => {
    const t = trialEndView(ch, trialEndViewer(ch, K));
    expect(t.did.rows.find((r) => r.label === 'Fixes open with packets')!.detail).toBe('none');
    expect(t.stays[0]!.how).toBe('monthly checks');
  });
});

describe('Trial ending, the reminder line around its date (fix round 2, item 4)', () => {
  // The reminder is due Wed 4 Nov, 21:41 in Indiana; the trial ends Sat 7 Nov.
  const at = (now: string) => trialEndView(bad, { accountId: BAD, now }).banner.sub;
  const NO_CARD = 'No card is on file, so nothing is charged either way.';

  it('before the day, and on it, says the day it is due', () => {
    expect(at('2026-11-01T12:00:00.000Z')).toBe(
      `The reminder is due once, on Wed 4 Nov. ${NO_CARD}`,
    );
    expect(at('2026-11-04T13:00:00.000Z')).toBe(
      `The reminder is due once, on Wed 4 Nov. ${NO_CARD}`,
    );
  });

  it('later on the day, after the moment it was due, still says the day', () => {
    // 03:00Z on 5 Nov is 22:00 on Wed 4 Nov in Indiana: past 21:41, still the reminder's day.
    expect(at('2026-11-05T03:00:00.000Z')).toBe(
      `The reminder is due once, on Wed 4 Nov. ${NO_CARD}`,
    );
  });

  it('once the day has passed, says nothing of it', () => {
    expect(at('2026-11-06T12:00:00.000Z')).toBe(NO_CARD);
  });

  it('with the reminder turned off, says nothing of it', () => {
    const off = {
      ...bad,
      accounts: bad.accounts.map((a) =>
        a.id === BAD ? { ...a, email_prefs: { ...a.email_prefs, trial_reminder: false } } : a,
      ),
    };
    expect(trialEndView(off, { accountId: BAD, now: '2026-11-01T12:00:00.000Z' }).banner.sub).toBe(
      NO_CARD,
    );
  });
});
