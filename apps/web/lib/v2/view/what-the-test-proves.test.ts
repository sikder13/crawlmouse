import { describe, expect, it } from 'vitest';
import type { Check, Verdict } from '@crawlmouse/types/v2';
import { FIXTURE_NAMES, findCheck, fixture, type ViewDataset } from '../fixtures';
import { CHECKS } from '../recordings';
import { VERDICTS } from '../../../components/v2/verdicts';
import { isAi, keptOutClauses, servedExtent } from '../sentences';
import { accessPill, resultView } from './result';
import { accessView } from './segment/access';

/** The sentences a reader meets first, on every graded check of every fixture. */
const graded = FIXTURE_NAMES.flatMap((name) => {
  const d = fixture(name) as ViewDataset;
  return (
    d.checks
      .filter((c) => c.status === 'finished' || c.status === 'partial')
      // The Result page needs both grades and the structure; a partial fixture row can hold none.
      .filter((c) => c.structure && c.technical_seo && c.ai_readability)
      .map((c) => ({ name, d, c }))
  );
});

const primaryText = (d: ViewDataset, c: Check) => {
  const r = resultView(d, c.id, { map: null, asFirstSeen: true });
  const a = accessView(d, c.id);
  return JSON.stringify({
    first: r.first,
    grades: r.grades.map((g) => g.summary),
    access: r.doors[0],
    headline: a.headline,
    method: a.method,
  });
};

/** A check whose AI crawlers hold these verdicts, in order; the rest stay as they were. */
function withVerdicts(verdicts: Verdict[]): Check {
  const c = structuredClone(findCheck(fixture('clean-site'), CHECKS.cleanFirstAudit));
  c.crawlers.filter(isAi).forEach((x, i) => {
    x.verdict = verdicts[i] ?? 'allowed';
    x.cause = null;
  });
  return c;
}

/** The clean-site dataset with this check in the place of its own. */
const fixtureOf = (c: Check): ViewDataset => {
  const d = structuredClone(fixture('clean-site')) as ViewDataset;
  d.checks = d.checks.map((x) => (x.id === c.id ? c : x));
  return d;
};

describe('a request in a crawler’s name is reported as that request', () => {
  it('reads every graded fixture check (the sweep is live)', () => {
    expect(graded.length).toBeGreaterThan(5);
  });

  it.each(graded.map((g) => [`${g.name} ${g.c.id.slice(-6)}`, g] as const))(
    '%s claims no crawler-level fact and no published address',
    (_label, { d, c }) => {
      expect(primaryText(d, c)).not.toMatch(
        /\bgets? in\b|admitted only|published IPs|in Settings and we test/,
      );
    },
  );

  it('keeps the three states apart in the pill, each with its count', () => {
    const label = accessPill(
      withVerdicts(['allowed', 'blocked_by_ua_rule', 'refused_unverified', 'refused_unverified']),
    ).label;
    expect(label).toBe('1 refused by user agent · 2 refused, unverified');
  });

  it('counts a challenge apart from a refusal to every crawler name', () => {
    const label = accessPill(withVerdicts(['challenged_ua', 'refused_unverified'])).label;
    expect(label).toBe('1 refused, unverified · 1 challenged');
  });

  it('says a served check was served to our requests, in numbers', () => {
    const c = withVerdicts([]);
    const n = c.crawlers.filter(isAi).length;
    expect(accessPill(c).label).toBe(`${n} of ${n} served`);
  });

  it('says what a refusal with a witness shows, and no more', () => {
    const c = withVerdicts(['blocked_by_ua_rule']);
    const [clause] = keptOutClauses(c.crawlers.filter((x) => x.verdict === 'blocked_by_ua_rule'));
    expect(clause).toMatch(
      /was refused when we sent its user agent, while another crawler name was served$/,
    );
  });

  it('says what a refusal with no witness shows, and does not name a cause as fact', () => {
    const c = withVerdicts(['refused_unverified']);
    const [clause] = keptOutClauses(c.crawlers.filter((x) => x.verdict === 'refused_unverified'));
    expect(clause).toMatch(
      /was refused, and no other crawler name was served on the same pages; this may be IP verification$/,
    );
  });
});

describe('each verdict in the matrix says how sure it is, and what a 404 was', () => {
  /** The bad site's Access view, after `edit` to a copy of its first audit. */
  const access = (edit: (c: Check) => void = () => {}) => {
    const d = structuredClone(fixture('bad-site')) as ViewDataset;
    const c = findCheck(d, CHECKS.badFirstAudit);
    edit(c);
    return accessView(d, c.id);
  };
  const rowOf = (v: ReturnType<typeof accessView>, ua: string) =>
    v.groups.flatMap((g) => g.rows).find((r) => r.ua === ua)!;

  it.each(['confirmed', 'likely', 'inconclusive'] as const)('shows %s from the check', (level) => {
    const v = access((c) => {
      c.crawlers.find((x) => x.ua === 'GPTBot')!.confidence = level;
    });
    expect(rowOf(v, 'GPTBot').confidence).toBe(level);
  });

  it.each([404, 410])('says a refusal verdict with a %i answered that status', (status) => {
    const v = access((c) => {
      const gpt = c.crawlers.find((x) => x.ua === 'GPTBot')!;
      gpt.verdict = 'blocked_by_ua_rule';
      gpt.by_template.forEach((t) => Object.assign(t, { verdict: 'blocked_by_ua_rule', status }));
    });
    const cell = rowOf(v, 'GPTBot').cells[0]!;
    expect(cell.verdict).toBe('blocked_by_ua_rule');
    expect(cell.qualifier).toBe(`(answered ${status} to our request)`);
  });

  it('leaves a 403 refusal as it was', () => {
    const v = access((c) => {
      const gpt = c.crawlers.find((x) => x.ua === 'GPTBot')!;
      gpt.verdict = 'blocked_by_ua_rule';
      gpt.by_template.forEach((t) =>
        Object.assign(t, { verdict: 'blocked_by_ua_rule', status: 403 }),
      );
    });
    expect(rowOf(v, 'GPTBot').cells[0]!.qualifier ?? '').not.toContain('answered');
  });

  it('does not say it of a 404 on a verdict that is not a refusal', () => {
    const v = access((c) => {
      const gpt = c.crawlers.find((x) => x.ua === 'GPTBot')!;
      gpt.verdict = 'allowed';
      gpt.by_template.forEach((t) => Object.assign(t, { verdict: 'allowed', status: 404 }));
    });
    expect(rowOf(v, 'GPTBot').cells[0]!.qualifier ?? '').not.toContain('answered');
  });
});

describe('how many pages a served verdict rests on', () => {
  /** The clean site with its AI crawlers measured on these numbers of its sampled pages. */
  function measuredOn(pages: number[]) {
    const d = structuredClone(fixture('clean-site')) as ViewDataset;
    const c = findCheck(d, CHECKS.cleanFirstAudit);
    c.coverage!.pages_sampled = 25;
    c.crawlers.filter(isAi).forEach((x, i) => {
      x.pages_measured = pages[i % pages.length]!;
    });
    return { d, c };
  }

  it('says the range when crawlers were measured on some of the sample', () => {
    const { d, c } = measuredOn([1, 4]);
    expect(servedExtent(c)).toBe(', on 1 to 4 of the 25 sampled pages');
    expect(accessPill(c)).toEqual({
      state: 'unverified',
      label: '6 of 6 served, on 1 to 4 of 25 pages',
    });
    const a = accessView(d, c.id);
    expect(a.headline.title).toBe(
      'Requests with all six AI crawlers’ user agents were served, on 1 to 4 of the 25 sampled pages.',
    );
    expect(resultView(d, c.id, { map: null }).doors[0]!.body).toContain(
      'were served, on 1 to 4 of the 25 sampled pages.',
    );
  });

  it('says one number when they all rest on the same count', () => {
    expect(servedExtent(measuredOn([3]).c)).toBe(', on 3 of the 25 sampled pages');
  });

  it('says nothing extra when each was measured on the whole sample', () => {
    const { c } = measuredOn([25]);
    expect(servedExtent(c)).toBe('');
    expect(accessPill(c)).toEqual({ state: 'ok', label: '6 of 6 served' });
  });

  it('reads a count above the sample as the whole sample', () => {
    expect(servedExtent(measuredOn([25, 214]).c)).toBe('');
  });

  it('counts only the crawlers that were served', () => {
    const { c } = measuredOn([25]);
    Object.assign(c.crawlers.filter(isAi)[0]!, {
      verdict: 'blocked_by_ua_rule',
      pages_measured: 1,
    });
    expect(servedExtent(c)).toBe('');
  });
});

describe('the method line, on the Access screen', () => {
  const { d, c } = graded.find((g) => g.name === 'bad-site')!;
  const method = accessView(d, c.id).method;

  it('says what we sent and from where', () => {
    expect(method).toContain('from Crawlmouse’s own address, not the operator’s');
  });

  it('says what the test cannot prove, in both directions', () => {
    expect(method).toContain('A rule matching the exact string will not fire on it');
    expect(method).toContain('may refuse it while serving the real crawler');
  });

  it('promises no exact-string mode, which does not exist', () => {
    expect(method).not.toMatch(/Settings|exact strings/);
  });
});

describe('what the crawler sentences may claim (review of PR 2a)', () => {
  it('takes the extent of the crawlers the sentence names', () => {
    const c = withVerdicts([]);
    c.coverage!.pages_sampled = 5;
    for (const x of c.crawlers.filter(isAi)) {
      x.verdict = 'allowed';
      x.evidence_class = 'simulated';
      x.pages_measured = x.scored ? 5 : 2;
    }
    expect(c.crawlers.some((x) => isAi(x) && !x.scored)).toBe(true);
    expect(
      servedExtent(
        c,
        false,
        c.crawlers.filter((x) => x.scored),
      ),
    ).toBe('');
    expect(servedExtent(c)).toBe(', on 2 to 5 of the 5 sampled pages');
  });

  it('does not say every other crawler name was refused: only that none was served', () => {
    const c = withVerdicts(['refused_unverified', 'challenged_ua', 'rate_limited']);
    const said = [
      ...keptOutClauses(c.crawlers.filter(isAi)),
      JSON.stringify(accessView(fixtureOf(c), c.id).headline),
    ];
    expect(said.join(' ')).not.toMatch(/as was every|refused to every/);
    expect(keptOutClauses(c.crawlers.filter(isAi)).join(' ')).toContain(
      'no other crawler name was served on the same pages',
    );
    expect(VERDICTS.refused_unverified.label).not.toMatch(/every/);
  });

  it('does not say the crawler requests were not sent, or count an unmeasured crawler as served', () => {
    const c = withVerdicts(['edge_blocks_automation']);
    const headline = JSON.stringify(accessView(fixtureOf(c), c.id).headline);
    expect(headline).not.toContain('were not sent');
    expect(headline).toContain('no crawler request was measured on those pages');
    expect(headline).toMatch(/the other \w+ AI crawlers/);
    expect(headline).not.toMatch(/Requests with all /);
  });
});
