/**
 * Alerts (Final-Alerts) against values worked out by hand from bad-site at its as_of (Fri 30 Oct
 * 10:05Z, 06:05 in Indiana). Five changes were notified (D4): three on example-outfitter.com's
 * weekly check c…06 and one on nahltech.com's c…0c, all sent 10:03Z; one on the staging site's
 * deploy check c…29, sent to Slack only on Tue 27 Oct 18:13:20Z.
 */
import { describe, expect, it } from 'vitest';
import { CLEAN_VIEWER } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { alertsView } from './alerts';

const bad = fixture('bad-site');
const BAD = 'a0000000-0000-4000-8000-000000000001';
const home = () => alertsView(bad, { accountId: BAD, now: bad.as_of });

describe('Alerts, the header', () => {
  it('counts the emails by message, not by row, and names the one open block with a fix', () => {
    // Messages: outfitter × c…06 (email + Slack), nahltech × c…0c (email), staging × c…29 (Slack).
    // The account began 25 Oct 02:41Z, Sat 24 Oct 22:41 in Indiana.
    expect(home().header.line).toBe(
      '2 emails since 24 Oct, one per site per check that found something · last Fri 30 Oct 06:03 · 1 open: Claude-SearchBot blocked',
    );
  });

  it('opens that fix as its one orange action', () => {
    expect(home().header.actions).toEqual([
      expect.objectContaining({
        label: 'Open the Claude-SearchBot fix',
        href: '/audit/c0000000-0000-4000-8000-000000000006/fix/f0000000-0000-4000-8000-000000000000',
        primary: true,
      }),
    ]);
  });
});

describe('Alerts, Fired (D4)', () => {
  it('lists one row per notified change, newest first, grouped by site and check', () => {
    const rows = home().fired.rows;
    expect(
      rows.map((r) => [r.key.slice(-3), r.when, r.site, r.pill.label, r.pill.state, r.what, r.to]),
    ).toEqual([
      [
        '001',
        'Fri 30 Oct 06:03',
        'example-outfitter.com',
        'crawler blocked',
        'bad',
        'Claude-SearchBot, all pages · robots.txt changed Thu 19:40',
        'email, #seo',
      ],
      [
        '002',
        'Fri 30 Oct 06:03',
        'example-outfitter.com',
        'crawler blocked',
        'warn',
        'ClaudeBot, all pages · robots.txt changed Thu 19:40',
        'email, #seo',
      ],
      [
        '003',
        'Fri 30 Oct 06:03',
        'example-outfitter.com',
        'grade moved',
        'bad',
        'AI readability D 41 → F 22',
        'email, #seo',
      ],
      [
        '005',
        'Fri 30 Oct 06:03',
        'nahltech.com',
        'resolved',
        'ok',
        '3 orphan pages now linked · SEO +5',
        'email',
      ],
      [
        '006',
        'Tue 27 Oct 14:13',
        'staging.example-outfitter.dev',
        'deploy audited',
        'ok',
        'no change to either grade',
        '#seo',
      ],
    ]);
    expect(rows.map((r) => r.open.href)).toEqual([
      ...Array(3).fill('/audit/c0000000-0000-4000-8000-000000000006'),
      '/audit/c0000000-0000-4000-8000-00000000000c',
      '/audit/c0000000-0000-4000-8000-000000000029',
    ]);
  });

  it('words its footnote from the messages: two emails, one carrying three rows, and the Slack one', () => {
    expect(home().fired.foot).toBe(
      'One email per site per check that found something: Fri 06:03 sent two, one for example-outfitter.com carrying three rows and one for nahltech.com. The staging deploy went to Slack only. Checks that found nothing sent nothing.',
    );
    expect(home().fired.sub).toBe(
      'Everything that was sent, newest first. One email per site per check that found something, from alerts@crawlmouse.com.',
    );
  });

  it('lists nothing sent after now: at 10:02:30Z the morning’s mail has not gone out', () => {
    const early = alertsView(bad, { accountId: BAD, now: '2026-10-30T10:02:30Z' });
    expect(early.fired.rows.map((r) => r.key.slice(-3))).toEqual(['006']);
    expect(early.header.line).toBe(
      'No emails since 24 Oct; one Slack message, last Tue 27 Oct 14:13',
    );
    expect(early.header.actions).toEqual([]);
  });
});

describe('Alerts, where they go and the rules', () => {
  it('reads the address, the change-note preference and the Slack workspace from the account', () => {
    expect(home().channels.rows.map((r) => [r.label, r.value, r.state?.label ?? null])).toEqual([
      ['Email', 'you@company.com', 'on'],
      ['Slack', 'Nahl · #seo', 'on'],
      ['Slack channel per site', 'set on each site page', null],
    ]);
    expect(home().channels.rows[2]!.action!.href).toBe(
      '/sites/50000000-0000-4000-8000-000000000001',
    );
    expect(home().channels.foot).toBe(
      'Slack is Pro. When the 14 days end, email alerts continue on Free for the first site.',
    );
  });

  it('lists the account’s rules with a switch each, posting to the account rules route', () => {
    const r = home().rules;
    expect(r.rows.map((x) => [x.label, x.on])).toEqual([
      ['A crawler becomes blocked', true],
      ['Text without JavaScript drops more than 10 points', true],
      ['A grade moves a full letter', true],
      ['New orphan pages', true],
      ['A fix you marked done regresses', true],
      ['Any change at all, including content', false],
    ]);
    expect(r.rows[0]!.toggle).toMatchObject({
      href: '/api/alert-rules',
      fields: { _method: 'PUT', rule: '70000000-0000-4000-8000-000000000001' },
    });
    expect(r.foot).toBe(
      'Each site can override these on its own page. Quiet by default: the last rule is off. On Fri, 17 pages changed content and nothing was sent.',
    );
  });
});

describe('Alerts, on the stand-in Free account (clean-site)', () => {
  const free = () => alertsView(fixture('clean-site'), CLEAN_VIEWER);

  it('has nothing sent, no rules, no orange action, and Slack as a Pro feature', () => {
    const v = free();
    expect(v.header.line).toBe('No alerts sent yet.');
    expect(v.header.actions).toEqual([]);
    expect(v.fired.rows).toEqual([]);
    expect(v.fired.empty).toBe(
      'Nothing has been sent yet. A check that finds a change sends one email.',
    );
    expect(v.rules.rows).toEqual([]);
    expect(v.rules.empty).toBe('No alert rules yet.');
    expect(v.channels.rows.map((r) => [r.label, r.value, r.state?.label ?? null])).toEqual([
      ['Email', 'owner@trailhead.example', 'on'],
      ['Slack', 'on Pro', 'off'],
      ['Slack channel per site', 'set on each site page', null],
    ]);
    expect(v.channels.foot).toBe('Slack is Pro. On Free, email alerts cover the first site.');
  });
});

describe('Alerts, a site notified at two checks', () => {
  it('sends one message per check, not one per site', () => {
    // bad-site with the first audit's change (7, c…01) notified by email too: example-outfitter.com
    // then has two notified checks, c…01 and c…06, which are two messages, not one.
    const d = {
      ...bad,
      changes: bad.changes.map((c) =>
        c.id === '90000000-0000-4000-8000-000000000007'
          ? {
              ...c,
              notified: {
                channels: ['email' as const],
                slack_channel: null,
                sent_at: '2026-10-25T02:35:00Z',
              },
            }
          : c,
      ),
    };
    const v = alertsView(d, { accountId: BAD, now: bad.as_of });
    expect(v.fired.messages.map((m) => [m.host, m.checkId.slice(-3), m.rows.length])).toEqual([
      ['example-outfitter.com', '006', 3],
      ['nahltech.com', '00c', 1],
      ['staging.example-outfitter.dev', '029', 1],
      ['example-outfitter.com', '001', 1],
    ]);
    expect(v.header.line).toMatch(/^3 emails since /);
  });
});
