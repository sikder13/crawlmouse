import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  aiReadabilityStatus,
  CheckStatusSchema,
  crawlerRegistryVersion,
  DetectionStateSchema,
  detectionStatus,
  serialiseRegistry,
  technicalSeoStatus,
  VerdictSchema,
  verdictStatus,
  type CrawlerRegistryEntry,
} from './index.js';

/**
 * The owner's mapping of 2026-11-03 (docs/specs/v2/06b-data-foundations.md), written out by hand so
 * the functions are checked against the ruling, not against themselves.
 */
const VERDICT_STATUS: Record<string, string> = {
  allowed: 'measured',
  allowed_thin: 'measured',
  disallowed_by_robots: 'measured',
  blocked_by_ua_rule: 'measured',
  challenged_ua: 'measured',
  refused_unverified: 'measured',
  rate_limited: 'measured',
  payment_required: 'measured',
  edge_blocks_automation: 'not_measurable',
  redirected_away: 'measured',
  not_measured: 'unevaluable',
};

describe('verdictStatus', () => {
  it('the table covers every verdict, and nothing else', () => {
    expect(Object.keys(VERDICT_STATUS).sort()).toEqual([...VerdictSchema.options].sort());
  });

  it.each(Object.entries(VERDICT_STATUS))('%s is %s', (verdict, status) => {
    expect(verdictStatus(verdict as never)).toBe(status);
  });
});

describe('detectionStatus', () => {
  it.each([
    ['detected', 'measured'],
    ['not_detected', 'measured'],
    ['indeterminate', 'unevaluable'],
  ])('%s is %s', (state, status) => {
    expect(detectionStatus(state as never)).toBe(status);
  });

  it('covers every detection state', () => {
    expect([...DetectionStateSchema.options].sort()).toEqual([
      'detected',
      'indeterminate',
      'not_detected',
    ]);
  });
});

describe('the grade statuses', () => {
  const given = { refusal: { refused: false } };
  const refused = { refusal: { refused: true } };

  it.each(['queued', 'running', 'deferred'] as const)('null while the check is %s', (status) => {
    expect(technicalSeoStatus({ status, technical_seo: null })).toBeNull();
    expect(aiReadabilityStatus({ status, ai_readability: null })).toBeNull();
  });

  it.each(['finished', 'partial', 'failed'] as const)(
    'on a %s check: no grade is not_measurable',
    (status) => {
      expect(technicalSeoStatus({ status, technical_seo: null })).toBe('not_measurable');
      expect(aiReadabilityStatus({ status, ai_readability: null })).toBe('not_measurable');
    },
  );

  it.each(['finished', 'partial'] as const)('on a %s check: refused and withheld', (status) => {
    expect(technicalSeoStatus({ status, technical_seo: refused })).toBe('withheld');
    expect(technicalSeoStatus({ status, technical_seo: given })).toBe('measured');
    expect(aiReadabilityStatus({ status, ai_readability: { withheld: true } })).toBe('withheld');
    expect(aiReadabilityStatus({ status, ai_readability: { withheld: false } })).toBe('measured');
  });

  it('a graded check with unevaluable refusal triggers is measured, and keeps the triggers', () => {
    const technical_seo = {
      refusal: {
        refused: false,
        triggers: [],
        confidenceCapped: false,
        unevaluable: ['nothing_read'],
      },
    };
    expect(technicalSeoStatus({ status: 'finished', technical_seo })).toBe('measured');
    expect(technical_seo.refusal.unevaluable).toEqual(['nothing_read']);
  });

  it('every check status is decided', () => {
    for (const status of CheckStatusSchema.options) {
      expect(() => technicalSeoStatus({ status, technical_seo: null })).not.toThrow();
    }
  });
});

describe('crawlerRegistryVersion', () => {
  const entry = (patch: Partial<CrawlerRegistryEntry> = {}): CrawlerRegistryEntry => ({
    token: 'GPTBot',
    group: 'ai_training',
    scored: false,
    operator: 'OpenAI',
    purpose: 'Collects pages for model training.',
    robots_token: 'GPTBot',
    ua_string: null,
    verification_method: ['ip_list'],
    ip_list_url: 'https://openai.com/gptbot.json',
    testable: true,
    needs_owner_logs: true,
    source_url: 'https://developers.openai.com/api/docs/bots',
    source_notes: [],
    as_of: '2026-10-27',
    cloudflare_categories: ['training'],
    cloudflare_as_of: '2026-11-03',
    ...patch,
  });
  const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

  it('is the sha256 of the entry as JSON with its keys sorted, written out here by hand', async () => {
    const expected =
      '{"as_of":"2026-10-27","cloudflare_as_of":"2026-11-03","cloudflare_categories":["training"],' +
      '"group":"ai_training","ip_list_url":"https://openai.com/gptbot.json",' +
      '"needs_owner_logs":true,"operator":"OpenAI","purpose":"Collects pages for model training.",' +
      '"robots_token":"GPTBot","scored":false,"source_notes":[],' +
      '"source_url":"https://developers.openai.com/api/docs/bots","testable":true,"token":"GPTBot",' +
      '"ua_string":null,"verification_method":["ip_list"]}';
    expect(serialiseRegistry([entry()])).toBe(expected);
    expect(await crawlerRegistryVersion([entry()])).toBe(sha256(expected));
  });

  it('joins entries in sorted order with newlines, whatever order they come in', async () => {
    const a = entry();
    const b = entry({ token: 'ClaudeBot', robots_token: 'ClaudeBot', operator: 'Anthropic' });
    const lines = [serialiseRegistry([a]), serialiseRegistry([b])].sort();
    expect(serialiseRegistry([a, b])).toBe(lines.join('\n'));
    expect(await crawlerRegistryVersion([b, a])).toBe(await crawlerRegistryVersion([a, b]));
  });

  it('does not depend on the order of an entry’s keys', async () => {
    const reordered = Object.fromEntries(Object.entries(entry()).reverse()) as CrawlerRegistryEntry;
    expect(await crawlerRegistryVersion([reordered])).toBe(await crawlerRegistryVersion([entry()]));
  });

  it('tells apart two edits made on the same day, which as_of cannot', async () => {
    const first = await crawlerRegistryVersion([entry({ purpose: 'Training.' })]);
    const second = await crawlerRegistryVersion([entry({ purpose: 'Model training.' })]);
    expect(first).not.toBe(second);
    expect(entry().as_of).toBe(entry({ purpose: 'Training.' }).as_of);
  });

  it('changes with any one value, nested arrays included', async () => {
    const base = await crawlerRegistryVersion([entry()]);
    for (const patch of [
      { scored: true },
      { ua_string: 'GPTBot/1.4' },
      {
        verification_method: [
          'ip_list',
          'reverse_dns',
        ] as CrawlerRegistryEntry['verification_method'],
      },
      { source_notes: ['a caveat'] },
      { as_of: null },
    ]) {
      expect(await crawlerRegistryVersion([entry(patch)]), JSON.stringify(patch)).not.toBe(base);
    }
  });

  it('refuses an entry the contract refuses, rather than serialise it', () => {
    expect(() => serialiseRegistry([{ ...entry(), as_of: undefined } as never])).toThrow();
    expect(() => serialiseRegistry([{ ...entry(), extra: 1 } as never])).toThrow();
  });

  it('is 64 lowercase hex characters, the column’s shape', async () => {
    expect(await crawlerRegistryVersion([entry()])).toMatch(/^[0-9a-f]{64}$/);
    expect(await crawlerRegistryVersion([])).toBe(sha256(''));
  });
});
