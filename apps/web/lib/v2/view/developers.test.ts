/**
 * The Developers page's JSON example is a public contract (CC-29 D5, DECISION J13). It is built from
 * the fixture; these tests parse every part of the view's JSON against the v2 type contract, pin its
 * field names to the artboard's as FACTS revised them (A1, B2), and hold its values to the fixture's
 * check, read here directly rather than through the builder. That the rendered page prints this JSON
 * and no other is `__tests__/v2/public-pages.test.tsx`'s ("/developers, v2").
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CountSchema,
  CrawlerResultSchema,
  EffectSchema,
  FixSchema,
  GradeNameSchema,
  ScoreSchema,
  TimestampSchema,
  VerdictSchema,
} from '@crawlmouse/types/v2';
import { READ_API } from '../copy/developers';
import { FIXTURE_NAMES, findCheck, fixture } from '../fixtures';
import { API_SAMPLE_CHECK, ELIDED, apiSample, developersView, formatSample } from './developers';

const view = developersView();
const printed = JSON.parse(view.sample.json) as Record<string, unknown>;
const check = findCheck(fixture('bad-site'), API_SAMPLE_CHECK);

const keys = (o: unknown) => Object.keys(o as object);

describe('the JSON example on the Developers page', () => {
  it('is the builder’s sample, printed as JSON that parses back to it', () => {
    expect(printed).toEqual(apiSample(fixture('bad-site'), API_SAMPLE_CHECK).sample);
  });

  it('has the artboard’s fields, as FACTS A1 and B2 revised them, in its order', () => {
    expect(keys(printed)).toEqual(['audited_at', 'grades', 'crawlers', 'fixes', 'links']);
    expect(keys(printed.grades)).toEqual(['technical_seo', 'ai_readability']);
    for (const row of printed.crawlers as object[]) {
      expect(keys(row)).toEqual(['ua', 'verdict', 'status', 'pages_measured', 'cause']);
    }
    for (const fix of printed.fixes as object[]) {
      expect(keys(fix)).toEqual(['id', 'title', 'effect', 'packet_url']);
    }
    expect(keys(printed.links)).toEqual(['nodes', 'edges', 'orphans', 'csv_url']);
  });

  it('parses part by part against the type contract', () => {
    TimestampSchema.parse(printed.audited_at);
    for (const [name, score] of Object.entries(printed.grades as object)) {
      GradeNameSchema.parse(name);
      ScoreSchema.nullable().parse(score);
    }
    const crawlers = printed.crawlers as Record<string, unknown>[];
    expect(crawlers.length).toBeGreaterThan(0);
    for (const row of crawlers) {
      for (const [field, value] of Object.entries(row)) {
        const schema = CrawlerResultSchema.shape[field as keyof typeof CrawlerResultSchema.shape];
        expect(schema, field).toBeDefined();
        schema.parse(value);
      }
    }
    const fixes = printed.fixes as Record<string, unknown>[];
    expect(fixes).toHaveLength(1);
    for (const fix of fixes) {
      FixSchema.shape.number.parse(fix.id);
      FixSchema.shape.title.parse(fix.title);
      for (const [field, value] of Object.entries(fix.effect as object)) {
        const schema = EffectSchema.shape[field as keyof typeof EffectSchema.shape];
        expect(schema, field).toBeDefined();
        schema.parse(value);
      }
      expect(fix.packet_url).toBe(ELIDED);
    }
    const links = printed.links as Record<string, unknown>;
    for (const field of ['nodes', 'edges', 'orphans']) CountSchema.parse(links[field]);
    expect(links.csv_url).toBe(ELIDED);
  });

  it('shows only the rows the word "blocked" may name (FACTS I2), each a verdict of the contract', () => {
    for (const row of printed.crawlers as { verdict: string }[]) {
      VerdictSchema.parse(row.verdict);
      expect(['disallowed_by_robots', 'blocked_by_ua_rule']).toContain(row.verdict);
    }
  });

  it('holds the values of the fixture’s check of Fri 30 Oct', () => {
    expect(check.trigger).toBe('scheduled');
    expect(printed.audited_at).toBe(check.finished_at);
    expect(printed.grades).toEqual({
      technical_seo: check.technical_seo!.score,
      ai_readability: check.ai_readability!.total,
    });
    expect((printed.crawlers as { ua: string }[]).map((c) => c.ua)).toEqual(
      check.crawlers
        .filter((c) => c.verdict === 'disallowed_by_robots' || c.verdict === 'blocked_by_ua_rule')
        .map((c) => c.ua),
    );
    expect(printed.links).toMatchObject({
      nodes: check.coverage!.pages_crawled,
      edges: check.structure!.internal_links,
      orphans: check.structure!.orphan_pages,
    });
  });

  it('says what it leaves out, from the counts', () => {
    expect(view.sample.shown).toContain(`of the ${'eight'} crawler rows`);
    expect(check.crawlers).toHaveLength(8);
  });

  it('prints the request line for the sample’s own site, with the key prefix of FACTS A4', () => {
    expect(view.sample.request).toContain('/v1/sites/example-outfitter.com/latest');
    expect(view.sample.request).toContain(`Bearer ${READ_API.keyPrefix}`);
  });
});

describe('apiSample on other checks', () => {
  it('gives a withheld AI readability grade as null, beside a scored technical grade', () => {
    const d = fixture('built-site');
    const withheld = d.checks.find(
      (c) => c.status === 'finished' && c.structure && c.coverage && c.ai_readability?.withheld,
    )!;
    expect(withheld).toBeDefined();
    expect(apiSample(d, withheld.id).sample.grades).toEqual({
      technical_seo: withheld.technical_seo!.score,
      ai_readability: null,
    });
  });

  it('refuses every check of every fixture that has not finished, and builds every one that has', () => {
    let refused = 0;
    for (const name of FIXTURE_NAMES) {
      const d = fixture(name);
      for (const c of d.checks) {
        const complete = c.status === 'finished' && c.finished_at && c.structure && c.coverage;
        if (complete) expect(() => apiSample(d, c.id), c.id).not.toThrow();
        else {
          expect(() => apiSample(d, c.id), c.id).toThrow(/has not finished/);
          refused++;
        }
      }
    }
    expect(refused).toBeGreaterThan(0);
  });
});

describe('formatSample', () => {
  it('parses back to what it printed, for empty and full arrays alike', () => {
    const { sample } = apiSample(fixture('bad-site'), API_SAMPLE_CHECK);
    for (const s of [sample, { ...sample, crawlers: [], fixes: [] }]) {
      expect(JSON.parse(formatSample(s))).toEqual(s);
    }
  });
});

describe('the read-only API the page calls coming', () => {
  // The page says the API is not here yet: no route serves it and no key can be created. These read
  // the places either would have to appear; they fail when one does, and the page's words change then.
  const WEB = join(__dirname, '../../..');
  const REPO = join(WEB, '../..');
  const files = (dir: string, ext = /\.tsx?$/): string[] =>
    !existsSync(dir)
      ? []
      : readdirSync(dir).flatMap((n) => {
          const p = join(dir, n);
          if (n === 'node_modules' || n === '.next') return [];
          return statSync(p).isDirectory() ? files(p, ext) : ext.test(n) ? [p] : [];
        });
  const notTest = (f: string) => !/\.test\.tsx?$/.test(f);
  const app = files(join(WEB, 'app'));

  it('is served by no route: none under a v1 path or for a site’s latest audit, none naming the key prefix', () => {
    expect(app.length).toBeGreaterThan(100);
    const routes = app.filter((f) => /\/route\.tsx?$/.test(f)).map((f) => f.slice(WEB.length));
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.filter((r) => /\/v1\/|\/latest\//.test(r))).toEqual([]);
    expect(app.filter((f) => readFileSync(f, 'utf8').includes(READ_API.keyPrefix))).toEqual([]);
  });

  it('can create no key: no source or migration inserts an api_keys row', () => {
    const sources = [
      ...['app', 'lib', 'components'].flatMap((d) => files(join(WEB, d))),
      ...['inngest', 'packages', 'scripts'].flatMap((d) => files(join(REPO, d))),
    ].filter(notTest);
    const sql = files(join(REPO, 'infra/supabase/migrations'), /\.sql$/);
    expect(sources.length).toBeGreaterThan(200);
    expect(sql.length).toBeGreaterThan(20);
    const writes =
      /from\(\s*['"]api_keys['"]\s*\)\s*\.\s*(insert|upsert)|insert\s+into\s+(public\.)?api_keys/i;
    expect([...sources, ...sql].filter((f) => writes.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('is marked coming in the heading and not claimed in the present', () => {
    expect(view.sample.coming).toBe('coming');
    expect(`${view.h1} ${view.intro}`).not.toMatch(/\btoday\b|available now/i);
  });
});
