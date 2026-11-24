/**
 * The result of a check the site refused (inbox 024, QA 047 rows 4 to 8), and the Pro prompt on a
 * kept audit. Each case changes a fixture's stored fields, as a real refused row has them.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { ResultScreen } from '../../components/v2/screens/result/ResultScreen';
import { fixture } from '../../lib/v2/fixtures';
import { AuditPageProvider } from '../../components/v2/screens/result/AuditPage';
import { auditPage } from '../../app/audit/[id]/_lib/page-data';
import { CRAWL } from '../../../../packages/worker/src/identities';
import { CRAWL_USER_AGENT } from '../../lib/v2/help/pinned';
import { CHECKS } from '../../lib/v2/recordings';
import { resultView, type ResultView } from '../../lib/v2/view/result';

const NO_MAP = { nodes: [], positions: {} };
const ID = CHECKS.cleanFirstAudit;

function view(
  change: (c: Check, d: FixtureDataset) => void = () => {},
  asFirstSeen = false,
): ResultView {
  const d = structuredClone(fixture('clean-site'));
  change(d.checks.find((c) => c.id === ID)!, d);
  return resultView(d, ID, { map: NO_MAP, asFirstSeen });
}

/** An account keeps the check's site. */
const keep = (c: Check, d: FixtureDataset) => {
  d.sites.find((x) => x.id === c.site_id)!.account_id = '00000000-0000-4000-8000-0000000000aa';
};

/** Nothing graded, and every page of the check answered with `code`. */
const answered = (code: number, asFirstSeen = false) =>
  view((c, d) => {
    Object.assign(c.technical_seo!, { grade: null, score: null });
    d.page_results = d.page_results
      .filter((p) => p.check_id === c.id)
      .map((p) => ({ ...p, status_code: code }));
  }, asFirstSeen);

const card = (v: ResultView) => {
  if (v.first.kind !== 'not-served') throw new Error(`got ${v.first.kind}`);
  return v.first;
};
const signals = (v: ResultView) => v.doors.find((x) => x.title === 'Agent-readiness signals')!;
/** As a real audit page renders it: with that page's links, which hold no re-run route. */
const html = (v: ResultView) =>
  renderToStaticMarkup(
    <AuditPageProvider page={auditPage(ID, 'result')}>
      <ResultScreen data={v} checkId={ID} />
    </AuditPageProvider>,
  );
/** The rendered log block, where advice to allow something would sit. */
const logBlock = (out: string) =>
  out.slice(
    out.indexOf('our page requests appear as'),
    out.indexOf('How our crawler identifies itself'),
  );
const ADVICE = /\ballow|whitelist|exception/i;
const COMPETITOR = 'Is a competitor this readable?';

describe('the next step on a refused check', () => {
  it.each([401, 403, 429])('%i: names our crawl’s exact user agent, and /bot', (code) => {
    expect(card(answered(code)).logIdentity).toEqual({
      agent: CRAWL.userAgent,
      href: '/bot',
      untaggedControl: false,
    });
    expect(CRAWL_USER_AGENT).toBe(CRAWL.userAgent);
  });

  it.each([401, 403, 429, 451])('%i: names it for the logs, and advises no allow rule', (code) => {
    const out = html(answered(code));
    expect(out).toContain('In your firewall or CDN logs, our page requests appear as:');
    expect(card(answered(code)).body).not.toMatch(ADVICE);
    expect(logBlock(out).length).toBeGreaterThan(0);
    expect(logBlock(out)).not.toMatch(ADVICE);
    expect(out).not.toContain('carries no Crawlmouse tag');
  });

  it('says the same on a check the edge refused', () => {
    const v = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 403 }));
      for (const x of c.crawlers.filter((x) => x.group !== 'search_engine'))
        Object.assign(x, { verdict: 'edge_blocks_automation', status: 403 });
    });
    expect(card(v).logIdentity).toEqual({
      agent: CRAWL.userAgent,
      href: '/bot',
      untaggedControl: true,
    });
    expect(html(v)).toContain('carries no Crawlmouse tag');
    expect(card(v).body).not.toMatch(ADVICE);
    expect(logBlock(html(v))).not.toMatch(ADVICE);
  });

  it.each([
    [401, 'a login or password requirement'],
    [403, 'a firewall or bot rule'],
    [429, 'a rate limit'],
    [451, 'a legal or regional restriction'],
  ])('%i names only its own cause', (code, cause) => {
    const body = card(answered(code)).body;
    expect(body).toContain(`look for ${cause},`);
    for (const other of ['login', 'firewall', 'rate limit', 'legal'])
      if (!cause.includes(other)) expect(body).not.toContain(other);
  });

  it('a mix of refusals names each cause', () => {
    const v = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      const rows = d.page_results.filter((p) => p.check_id === c.id);
      d.page_results = rows.map((p, i) => ({ ...p, status_code: i ? 403 : 401 }));
    });
    expect(card(v).body).toContain(
      'look for a login or password requirement or a firewall or bot rule,',
    );
  });

  it('the body’s next step matches the button', () => {
    expect(card(answered(429, true)).body).toContain('then run a new audit.');
    const kept = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 429 }));
      keep(c, d);
    });
    expect(card(kept).body).toContain('then run it again from Sites.');
  });

  it.each([404, 500, 301])('%i is not a refusal, so it names no user agent', (code) => {
    expect(card(answered(code)).logIdentity).toBeUndefined();
    expect(html(answered(code))).not.toContain('How our crawler identifies itself');
  });

  it('draws the user agent, the link and a working button', () => {
    const out = html(answered(429));
    expect(out).toContain(CRAWL.userAgent);
    expect(out).toMatch(/<a href="\/bot">How our crawler identifies itself<\/a>/);
    expect(out).toMatch(
      /<a [^>]*href="\/"[^>]*data-v2-primary[^>]*>Run a new audit<|<a [^>]*data-v2-primary[^>]*href="\/"[^>]*>Run a new audit</,
    );
  });

  it('offers Sites on a kept audit', () => {
    const v = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 429 }));
      keep(c, d);
    });
    expect(card(v).action).toEqual({ label: 'Open Sites', href: '/dashboard' });
  });

  it('has one primary button, kept or not', () => {
    const refuse = (c: Check, d: FixtureDataset) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 429 }));
    };
    const kept = view((c, d) => {
      refuse(c, d);
      keep(c, d);
    });
    expect(kept.keptUntil).toBeNull();
    expect(html(kept).match(/data-v2-primary/g)).toHaveLength(1);
    const unkept = view(refuse);
    expect(unkept.keptUntil).not.toBeNull();
    expect(html(unkept).match(/data-v2-primary/g)).toHaveLength(1);
  });
});

describe('429 in words', () => {
  it('labels only 429 when two statuses are named', () => {
    const v = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      const rows = d.page_results.filter((p) => p.check_id === c.id);
      d.page_results = rows.map((p, i) => ({ ...p, status_code: i ? 451 : 429 }));
    });
    expect(card(v).body).toContain(
      'with 429 (“too many requests”: the site is limiting requests) or 451.',
    );
  });

  it('is explained once', () => {
    expect(card(answered(429)).body.match(/too many requests/g)).toHaveLength(1);
  });

  it('is not added to another status', () => {
    expect(card(answered(403)).body).not.toContain('too many requests');
  });
});

describe('the signals card', () => {
  const refusedWithPeriods = view((c, d) => {
    Object.assign(c.technical_seo!, { grade: null, score: null });
    d.page_results = d.page_results
      .filter((p) => p.check_id === c.id)
      .map((p) => ({ ...p, status_code: 429 }));
    c.signals = [
      {
        signal: 'schema_org',
        state: 'indeterminate',
        evidence: 'No graded page to read.',
        counts_toward_grade: true,
        recommendation_class: 'best_practice',
      },
      {
        signal: 'content_signals',
        state: 'not_detected',
        evidence: 'robots.txt has no Content-Signal line.',
        counts_toward_grade: true,
        recommendation_class: 'best_practice',
      },
    ] as Check['signals'];
  });

  it('has no double full stop when the stored evidence ends in one', () => {
    expect(signals(refusedWithPeriods).body).toContain('No graded page to read.');
    expect(signals(refusedWithPeriods).body).not.toContain('..');
  });

  it('keeps a full stop when the evidence has none', () => {
    const v = view((c) => {
      const s = c.signals.find((x) => x.signal === 'llms_txt')!;
      Object.assign(s, { state: 'indeterminate', evidence: 'not requested' });
    });
    expect(signals(v).body).toContain('not requested.');
  });

  it('a check that read no page counts what it tested', () => {
    expect(signals(refusedWithPeriods).pill.label).toBe('0 found, 1 of 7 tested');
  });

  it('says Not tested when nothing was', () => {
    const v = view((c, d) => {
      Object.assign(c.technical_seo!, { grade: null, score: null });
      d.page_results = d.page_results
        .filter((p) => p.check_id === c.id)
        .map((p) => ({ ...p, status_code: 429 }));
      c.signals = [];
    });
    expect(signals(v).pill.label).toBe('Not tested');
  });

  it('groups evidence that differs only by its full stop', () => {
    const v = view((c) => {
      c.signals = (['llms_txt', 'mcp_server_card'] as const).map((signal, i) => ({
        signal,
        state: 'indeterminate',
        evidence: i ? 'not requested' : 'not requested.',
        counts_toward_grade: false,
        recommendation_class: 'experimental',
      })) as Check['signals'];
    });
    expect(signals(v).body.match(/not requested/g)).toHaveLength(1);
  });

  it('a check that read pages keeps its count', () => {
    expect(signals(view()).pill.label).toMatch(/^\d of 7 present$/);
  });
});

describe('the crawler table’s Status', () => {
  const statusOf = (ua: string, fields: Partial<Check['crawlers'][number]>) => {
    const v = view((c) => {
      Object.assign(c.crawlers.find((x) => x.ua === ua)!, fields);
    });
    return v.crawlers!.find((r) => r.ua === ua)!.status;
  };

  it('a crawler with no measurement says so', () => {
    expect(statusOf('GPTBot', { status: null, verdict: 'not_measured' })).toBe('not measured');
  });

  it('a verdict read from robots.txt still names it', () => {
    expect(
      statusOf('Googlebot', { status: null, verdict: 'allowed', evidence_class: 'declared' }),
    ).toBe('robots.txt');
  });

  it('a robots.txt block still names robots.txt', () => {
    expect(
      statusOf('GPTBot', {
        status: null,
        verdict: 'disallowed_by_robots',
        evidence_class: 'declared',
        cause: 'robots_txt_disallow',
      }),
    ).toBe('robots.txt');
  });

  it('a request sent with no standard status is not called robots.txt', () => {
    expect(
      statusOf('GPTBot', {
        status: null,
        verdict: 'blocked_by_ua_rule',
        evidence_class: 'simulated',
      }),
    ).toBe('no standard status');
  });

  it('a measured status is shown, whatever the verdict', () => {
    expect(statusOf('GPTBot', { status: 403, verdict: 'not_measured' })).toBe('403');
  });
});

describe('the competitor card', () => {
  it('is not offered on a check where nothing was served', () => {
    expect(html(answered(429, true))).not.toContain(COMPETITOR);
    expect(html(answered(500, true))).not.toContain(COMPETITOR);
  });

  it('is not offered on an audit already kept: its button says Keep', () => {
    const v = view(keep);
    expect(v.keptUntil).toBeNull();
    expect(html(v)).not.toContain(COMPETITOR);
  });

  it('is not offered when no AI crawler was measured', () => {
    const v = view((c) => {
      for (const x of c.crawlers.filter((x) => x.group !== 'search_engine'))
        Object.assign(x, { verdict: 'not_measured', status: null, text_share: null });
    }, true);
    expect(v.first.kind).not.toBe('not-served');
    expect(v.competitorPrompt).toBe(false);
    expect(html(v)).not.toContain(COMPETITOR);
  });

  it('is still offered on a served audit nobody has kept', () => {
    const v = view(() => {}, true);
    expect(v.keptUntil).not.toBeNull();
    expect(html(v)).toContain(COMPETITOR);
  });
});
