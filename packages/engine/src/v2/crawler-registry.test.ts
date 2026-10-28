import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CrawlerRegistryEntrySchema } from '@crawlmouse/types/v2';
import { AI_BOT_REGISTRY } from '../analysis/ai-readiness/constants.js';
import { CRAWLER_REGISTRY_V2 } from './crawler-registry.js';

const FACTS = readFileSync(
  new URL('../../../../docs/design/v2/FACTS-proposed.md', import.meta.url),
  'utf8',
);

/** FACTS line 7, read from the file: the scored, unscored and robots-only crawler sets (I6). */
function factsSets() {
  const line = FACTS.split('\n').find((l) => l.startsWith('Scored crawlers'))!;
  const list = (after: string) =>
    line
      .slice(line.indexOf(after) + after.length)
      .split('.')[0]!
      .split(',')
      .map((t) => t.trim());
  return {
    ai_search: list('B8 strings): '),
    ai_training: list('your choice"): '),
    search_engine: list('never a live verdict: '),
  };
}

describe('CRAWLER_REGISTRY_V2', () => {
  it.each(CRAWLER_REGISTRY_V2.map((e) => [e.token, e] as const))(
    '%s parses with CrawlerRegistryEntrySchema',
    (_token, entry) => {
      const result = CrawlerRegistryEntrySchema.safeParse(entry);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
  );

  it('tracks exactly the eight FACTS I6 crawlers, each in its FACTS group', () => {
    const sets = factsSets();
    for (const group of ['ai_search', 'ai_training', 'search_engine'] as const) {
      const tokens = CRAWLER_REGISTRY_V2.filter((e) => e.group === group).map((e) => e.token);
      expect(tokens.sort(), group).toEqual([...sets[group]].sort());
    }
    expect(new Set(CRAWLER_REGISTRY_V2.map((e) => e.token)).size).toBe(8);
  });

  it('scores exactly the AI search group', () => {
    for (const e of CRAWLER_REGISTRY_V2) expect(e.scored, e.token).toBe(e.group === 'ai_search');
  });

  it('takes the operator and purpose of every AI crawler from AI_BOT_REGISTRY', () => {
    for (const e of CRAWLER_REGISTRY_V2.filter((x) => x.group !== 'search_engine')) {
      const v1 = AI_BOT_REGISTRY.find((b) => b.token === e.token);
      expect(v1, e.token).toBeDefined();
      expect([e.operator, e.purpose]).toEqual([v1!.operator, v1!.note]);
      expect(e.group).toBe(v1!.botClass === 'retrieval' ? 'ai_search' : 'ai_training');
    }
  });

  it('marks the search engines untestable from outside (FACTS: never a live verdict)', () => {
    for (const e of CRAWLER_REGISTRY_V2)
      expect(e.testable, e.token).toBe(e.group !== 'search_engine');
  });

  it('needs owner logs exactly when the operator publishes a way to tell the real crawler from us', () => {
    for (const e of CRAWLER_REGISTRY_V2) {
      expect(e.needs_owner_logs, e.token).toBe(!e.verification_method.includes('none_published'));
    }
  });

  it('names the crawler in its user agent when one is published, and says so when none is', () => {
    for (const e of CRAWLER_REGISTRY_V2) {
      if (e.ua_string)
        expect(e.ua_string.toLowerCase(), e.token).toContain(e.robots_token.toLowerCase());
      else expect(e.source_notes.join(' '), e.token).toMatch(/prints no user-agent string/);
    }
  });

  it('dates every entry, and says why when a source could not be fetched', () => {
    for (const e of CRAWLER_REGISTRY_V2) {
      if (e.as_of === null)
        expect(e.source_notes.join(' '), e.token).toMatch(/could not be fetched/);
      else expect(e.as_of, e.token).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
