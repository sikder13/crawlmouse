import { describe, expect, it } from 'vitest';
import { SignalKindSchema } from '@crawlmouse/types/v2';
import { FIXTURE_NAMES, fixture } from '../../fixtures';
import { SIGNAL_TABLE } from '../../../../../../packages/engine/src/v2/access/declarations';
import { SCREEN_SIGNALS } from '../screen-signals';
import { SIGNAL_CLASSES, signalsView } from './signals';
import { asFirstSeen, edited } from './test-helpers';

const view = (name: (typeof FIXTURE_NAMES)[number], edit?: Parameters<typeof edited>[1]) => {
  const { d, id } = edited(name, edit);
  return signalsView(d, id, { asFirstSeen: asFirstSeen(name) });
};

describe('signalsView: the seven rows', () => {
  it('lists every signal the screens show, in the contract’s order, whatever the check recorded', () => {
    const inOrder = SignalKindSchema.options.filter((k) =>
      (SCREEN_SIGNALS as readonly string[]).includes(k),
    );
    expect([...SCREEN_SIGNALS]).toEqual(inOrder);
    for (const name of FIXTURE_NAMES) {
      expect(view(name).rows.map((r) => r.signal)).toEqual(inOrder);
    }
  });

  it('words each state: present, absent, not tested (could not look), not tested (not recorded)', () => {
    const bad = view('bad-site');
    const state = (v: ReturnType<typeof view>, s: string) => v.rows.find((r) => r.signal === s)!;
    expect(state(bad, 'schema_org').status).toEqual({ state: 'ok', label: 'present' });
    expect(state(bad, 'llms_txt').status).toEqual({ state: 'bad', label: 'absent' });
    expect(state(bad, 'web_bot_auth').status).toEqual({ state: 'unverified', label: 'not tested' });
    expect(state(bad, 'web_bot_auth').where).toBe(
      'Cloudflare can verify signed crawlers; we cannot test this from outside yet',
    );
    const clean = view('clean-site');
    expect(state(clean, 'mcp_server_card').status).toEqual({
      state: 'neutral',
      label: 'not tested',
    });
    expect(state(clean, 'mcp_server_card').where).toBe('not checked in this audit');
  });

  it('says a signal carries no weight exactly where the check says it does not count', () => {
    for (const name of FIXTURE_NAMES) {
      const { check } = edited(name);
      for (const r of view(name).rows) {
        const rec = check.signals.find((s) => s.signal === r.signal);
        if (!rec) expect(r.weight, `${name} ${r.signal}`).toBeNull();
        else
          expect(r.weight, `${name} ${r.signal}`).toBe(
            rec.counts_toward_grade
              ? 'Counts towards AI readability.'
              : 'Carries no weight in the grade.',
          );
      }
    }
  });

  it('gives each signal its proposed recommendation class, experimental for the five new ones', () => {
    const v = view('bad-site');
    expect(v.rows.map((r) => [r.signal, r.recommendation.cls])).toEqual([
      ['schema_org', 'best_practice'],
      ['content_signals', 'best_practice'],
      ['web_bot_auth', 'experimental'],
      ['llms_txt', 'experimental'],
      ['mcp_server_card', 'experimental'],
      ['markdown_negotiation', 'experimental'],
      ['agent_skills_index', 'experimental'],
    ]);
    expect(Object.keys(SIGNAL_CLASSES)).toEqual([...SCREEN_SIGNALS]);
  });

  it('does not call Web Bot Auth a fix or claim a lift we could not measure (FACTS I10)', () => {
    const r = view('bad-site').rows.find((x) => x.signal === 'web_bot_auth')!;
    expect(`${r.advice} ${r.lift}`).not.toMatch(/\bfix\b|in our crawls/i);
  });
});

describe('signalsView: headline, tiles and prose', () => {
  it('counts what is present, absent and untested', () => {
    const v = view('bad-site');
    expect(v.headline).toEqual({
      title: 'Two of seven agent signals are present.',
      pill: { state: 'neutral', label: '2 of 7' },
    });
    expect(v.tiles).toEqual([
      { label: 'Present', value: '2', note: null },
      { label: 'Absent', value: '4', note: null },
      { label: 'Not tested', value: '1', note: null },
      { label: 'Effect on the grade', value: '10 of 100', note: null },
    ]);
  });

  it('names what counts towards the grade, and how much, from the check (FACTS B5)', () => {
    expect(view('bad-site').body).toBe(
      'These are the files and headers that AI agents, not just crawlers, look for when they decide how to read a site. Most are new and some have no measured effect yet. Two of them, schema and Content Signals, are worth five points each of the AI readability grade; the other five change nothing yet and add no fixes. It tells you what is there, what is not, and which of the missing ones we have seen make a difference. Checked 25 Oct 2026 at 02:33 UTC.',
    );
    const one = view('bad-site', (c) => (c.signals[1]!.counts_toward_grade = false));
    expect(one.body).toContain(
      'One of them, schema, is worth ten points of the AI readability grade; the other six change nothing yet and add no fixes.',
    );
  });

  it('reads the grade weight from the AI readability components, withheld or not', () => {
    expect(view('challenged-site').tiles[3]).toEqual({
      label: 'Effect on the grade',
      value: '10 of 100',
      note: null,
    });
  });

  it('says what it read: the signals tested of seven', () => {
    expect(view('bad-site').coverage).toEqual({ read: 'Tested 6 of 7 signals' });
    expect(view('clean-site').coverage).toEqual({ read: 'Tested 3 of 7 signals' });
  });
});

describe('signalsView: the competitor', () => {
  it('compares what both audits measured, and holds the rest for Pro', () => {
    const c = view('bad-site').competitor!;
    expect(c.host).toBe('summitgear.co');
    expect(c.rows).toEqual([
      { measure: 'Crawlers that get in', own: '4 of 6', theirs: '6 of 6', pro: false },
      { measure: 'Text without JavaScript', own: '31%', theirs: '96%', pro: false },
      { measure: 'Technical SEO', own: 'B · 79', theirs: 'B- · 72', pro: false },
      { measure: 'AI readability', own: 'D · 41', theirs: 'with Pro', pro: true },
      { measure: 'Agent signals present', own: '2 of 7', theirs: 'with Pro', pro: true },
    ]);
    expect(c.verdict).toBe(
      'You are ahead on technical SEO and behind on what AI crawlers can read.',
    );
  });

  it('words the comparison from the numbers', () => {
    const c = view('bad-site', (ch) => {
      ch.competitors[0]!.technical_seo!.score = 79;
      ch.competitors[0]!.text_share = 0.2;
    }).competitor!;
    expect(c.verdict).toBe(
      'You are level on technical SEO and ahead on what AI crawlers can read.',
    );
  });

  it("says what the competitor's check could not measure, and compares only the rest", () => {
    const c = view('bad-site', (ch) => {
      const rival = ch.competitors[0] as unknown as Record<string, unknown>;
      rival.text_share = null;
      rival.technical_seo = null;
    }).competitor!;
    expect(c.rows.slice(1, 3)).toEqual([
      { measure: 'Text without JavaScript', own: '31%', theirs: 'not measured', pro: false },
      { measure: 'Technical SEO', own: 'B · 79', theirs: 'not graded', pro: false },
    ]);
    expect(c.verdict).toBe('');
  });

  it('compares the measure both checks hold when only one of the competitor’s is missing', () => {
    const c = view('bad-site', (ch) => {
      (ch.competitors[0] as unknown as Record<string, unknown>).text_share = null;
    }).competitor!;
    expect(c.rows[1]!.theirs).toBe('not measured');
    expect(c.rows[2]!.theirs).toBe('B- · 72');
    expect(c.verdict).toBe('You are ahead on technical SEO.');
  });

  it('has no comparison when the audit named no competitor', () => {
    expect(view('clean-site').competitor).toBeNull();
  });
});

describe('signalsView: a plan that compares competitors (F-256)', () => {
  /** bad-site's signals page as a reader whose plan compares `competitors`. */
  const paid = (competitors: number, edit?: Parameters<typeof edited>[1]) => {
    const { d, id } = edited('bad-site', edit);
    return signalsView(d, id, { asFirstSeen: asFirstSeen('bad-site'), competitors });
  };

  it('Pro shows the compared competitor in full, with no preview held back', () => {
    const v = paid(1);
    expect(v.competitor).toBeNull();
    expect(v.compared).toHaveLength(1);
    // summitgear.co's snapshot: AI readability A- · 88, 4 agent signals.
    expect(v.compared[0]!.rows.slice(3)).toEqual([
      { measure: 'AI readability', own: 'D · 41', theirs: 'A- · 88', pro: false },
      { measure: 'Agent signals present', own: '2 of 7', theirs: '4 of 7', pro: false },
    ]);
    expect(v.compared[0]!.rows.some((r) => r.theirs === 'with Pro')).toBe(false);
  });

  it('says what the competitor’s check could not give, never a held figure', () => {
    const v = paid(1, (ch) => {
      const rival = ch.competitors[0] as unknown as Record<string, unknown>;
      rival.ai_readability = null;
      rival.signals_present = null;
    });
    expect(v.compared[0]!.rows.slice(3).map((r) => r.theirs)).toEqual(['withheld', 'not read']);
  });

  it('Agency shows every compared competitor up to its three, and no more', () => {
    const rivals = (n: number) => (ch: { competitors: { host: string }[] }) => {
      const first = ch.competitors[0]!;
      ch.competitors.splice(
        0,
        ch.competitors.length,
        ...Array.from({ length: n }, (_, i) => ({ ...first, host: `rival-${i + 1}.example` })),
      );
    };
    expect(paid(3, rivals(3)).compared.map((c) => c.host)).toEqual([
      'rival-1.example',
      'rival-2.example',
      'rival-3.example',
    ]);
    expect(paid(3, rivals(4)).compared).toHaveLength(3);
    // Pro's one, of the same four.
    expect(paid(1, rivals(4)).compared.map((c) => c.host)).toEqual(['rival-1.example']);
  });

  it('a reader whose plan compares none still gets the preview held for Pro', () => {
    const v = paid(0);
    expect(v.compared).toEqual([]);
    expect(v.competitor?.rows.slice(3).map((r) => r.theirs)).toEqual(['with Pro', 'with Pro']);
  });
});

describe('SIGNAL_CLASSES against the data', () => {
  it('calls no signal experimental that any fixture counts towards the grade', () => {
    for (const name of FIXTURE_NAMES) {
      for (const c of fixture(name).checks) {
        for (const s of c.signals.filter((x) => x.counts_toward_grade)) {
          const shown = (SCREEN_SIGNALS as readonly string[]).includes(s.signal);
          expect(shown, `${name} ${s.signal} counts but is not shown`).toBe(true);
          expect(SIGNAL_CLASSES[s.signal as (typeof SCREEN_SIGNALS)[number]]).not.toBe(
            'experimental',
          );
        }
      }
    }
  });
});

describe('the signals the screens do not show', () => {
  it('carry no weight in the grade, so leaving them off a screen hides no part of it', () => {
    const hidden = SignalKindSchema.options.filter(
      (k) => !(SCREEN_SIGNALS as readonly string[]).includes(k),
    );
    expect(hidden.length).toBeGreaterThan(0);
    for (const k of hidden)
      expect(SIGNAL_TABLE[k], k).toMatchObject({ counts_toward_grade: false });
  });
});
