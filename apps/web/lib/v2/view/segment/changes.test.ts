import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Change } from '@crawlmouse/types/v2';
import { findCheck, fixture } from '../../fixtures';
import { changesView } from './changes';
import { asFirstSeen, edited } from './test-helpers';

const HISTORY = 'c0000000-0000-4000-8000-000000000006';
const CHALLENGED_RECHECK = 'c0000000-0000-4000-8000-0000000000ca';

const first = (name: Parameters<typeof edited>[0], edit?: Parameters<typeof edited>[1]) => {
  const { d, id } = edited(name, edit);
  return changesView(d, id, { asFirstSeen: asFirstSeen(name) });
};

describe('changesView: a first audit', () => {
  it('says nothing has changed, counts one audit, and lists it with its grades', () => {
    const v = first('bad-site');
    expect(v.state).toBe('first');
    expect(v.headline).toEqual({
      title: 'Nothing has changed yet, because nothing has checked again.',
      pill: { state: 'neutral', label: '1 audit' },
    });
    expect(v.tiles).toEqual([
      { label: 'Audits of this site', value: '1', note: null },
      { label: 'Kept until', value: '26 Oct, 02:34 UTC', note: null },
      { label: 'Next check', value: 'none scheduled', note: null },
    ]);
    expect(v.history).toEqual([
      {
        key: 'c0000000-0000-4000-8000-000000000001',
        when: '25 Oct 2026, 02:34 UTC',
        label: 'First audit · Technical SEO B · 79 · AI readability D · 41',
      },
    ]);
    expect(v.rows).toEqual([]);
    expect(v.example!.length).toBe(3);
  });

  it('says an account keeps it, and when it is next checked, once one does', () => {
    const v = first('challenged-site');
    expect(v.tiles.slice(1)).toEqual([
      { label: 'Kept', value: 'by an account', note: null },
      { label: 'Next check', value: 'weekly, Fri around 06:00', note: null },
    ]);
    expect(v.history[0]!.label).toBe(
      'First audit · Technical SEO C+ · 67 · AI readability withheld',
    );
    expect(v.keep).toBeNull();
    expect(v.historyNote).toBeNull();
  });

  it('reads the grades in the history from the check', () => {
    const v = first('bad-site', (c) => {
      c.technical_seo!.grade = 'B-';
      c.technical_seo!.score = 77;
    });
    expect(v.history[0]!.label).toBe('First audit · Technical SEO B- · 77 · AI readability D · 41');
  });
});

describe('changesView: a check that found changes', () => {
  const v = changesView(fixture('bad-site'), HISTORY);

  it('lists every change of the check, and counts them in the headline', () => {
    expect(v.state).toBe('changes');
    expect(v.rows.map((r) => r.summary)).toEqual([
      'Claude-SearchBot is now blocked on example-outfitter.com',
      'ClaudeBot is now blocked on example-outfitter.com',
      'AI readability moved from D to F',
      '17 pages changed content',
    ]);
    expect(v.headline).toEqual({
      title: 'Four changes found at the Fri 06:02 check.',
      pill: { state: 'neutral', label: '4 changes' },
    });
    expect(v.history).toHaveLength(6);
  });

  it('leaves out a change the same site recorded at another check', () => {
    const d = structuredClone(fixture('bad-site'));
    const earlier = { ...d.changes[0]!, id: '90000000-0000-4000-8000-0000000000ff' };
    earlier.check_id = 'c0000000-0000-4000-8000-000000000005';
    earlier.summary = 'An earlier change at the check before';
    d.changes.push(earlier);
    const rows = changesView(d, HISTORY).rows.map((r) => r.summary);
    expect(rows).toHaveLength(4);
    expect(rows).not.toContain('An earlier change at the check before');
  });

  it('says when, where, the effect, the robots.txt lines and who was told, in the account’s time', () => {
    const [claude, , grade, content] = v.rows;
    expect(claude).toMatchObject({
      when: 'Fri 06:02',
      kind: 'opened',
      pill: { state: 'bad', label: 'opened' },
      subject: 'crawler access',
      where: 'robots.txt',
      pages: '214 pages',
      effect: 'none',
      verdict: { verdict: 'disallowed_by_robots', evidence: 'declared' },
      told: 'email and Slack #seo, Fri 06:03',
    });
    expect(claude!.cause).toBe(
      'First observed after robots.txt changed Thu 19:40: a group for "User-agent: ClaudeBot" and "User-agent: Claude-SearchBot" with "Disallow: /" was added.',
    );
    expect(claude!.diff).toEqual([
      { sign: '+', line: 'User-agent: ClaudeBot' },
      { sign: '+', line: 'User-agent: Claude-SearchBot' },
      { sign: '+', line: 'Disallow: /' },
    ]);
    expect(grade!.effect).toBe('AI readability 41 → 22');
    expect(grade!.cause).toBe('First observed at this check; we found no cause.');
    expect(content!.cause).toBe(
      'First observed at this check. What we found: price and stock updates; grades unaffected.',
    );
    expect(content!.told).toBe('nobody was notified');
  });

  // The engine's own cause text is quoted as found, so inputs that contain the phrase are left out:
  // what this pins is the page's wording around it, which says "first observed", never "caused by".
  it('words every cause as first observed, never as caused by (property)', () => {
    const base = fixture('bad-site').changes[0]!;
    const changeArb = fc.record({
      kind: fc.constantFrom('opened', 'resolved', 'changed'),
      text: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !/caused by/i.test(s)),
      dated: fc.boolean(),
      hasCause: fc.boolean(),
      told: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(changeArb, { minLength: 1, maxLength: 5 }), (specs) => {
        const d = structuredClone(fixture('bad-site'));
        d.changes = specs.map(
          (s, i): Change => ({
            ...base,
            id: `90000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
            kind: s.kind as Change['kind'],
            cause: s.hasCause
              ? { text: s.text, changed_at: s.dated ? base.cause!.changed_at : null, diff: null }
              : null,
            notified: s.told ? base.notified : null,
          }),
        );
        const view = changesView(d, HISTORY);
        return (
          view.rows.length === specs.length &&
          view.rows.every(
            (r) => /^First observed /.test(r.cause) && !/\bcaused by\b/i.test(r.cause),
          )
        );
      }),
    );
  });

  it('counts two audits and one change for the challenged site’s re-check', () => {
    const c = changesView(fixture('challenged-site'), CHALLENGED_RECHECK);
    expect(c.history).toHaveLength(2);
    expect(c.rows).toHaveLength(1);
    expect(c.headline.title).toBe('One change found at the Wed 15:13 check.');
    expect(c.rows[0]!.told).toBe('email and Slack #clients-granitepeak, Wed 15:14');
  });

  it('compares with the check before it', () => {
    const prev = findCheck(fixture('bad-site'), 'c0000000-0000-4000-8000-000000000005');
    expect(v.coverage.read).toBe(
      `Compared with the check of ${new Date(prev.finished_at!).getUTCDate()} Oct 2026, ${prev.finished_at!.slice(11, 16)} UTC`,
    );
  });
});
