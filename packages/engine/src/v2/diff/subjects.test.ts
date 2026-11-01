import { readdirSync, readFileSync } from 'node:fs';
import {
  ChangeSubjectSchema,
  FixtureDatasetSchema,
  FixTypeSchema,
  type FixtureDataset,
} from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { COVERAGE_DEPENDENCE, FIX_SECTION, FIX_SUBJECT } from './subjects.js';

const FIXTURES = new URL('../../../../../apps/web/lib/fixtures/v2/', import.meta.url);
const datasets: [string, FixtureDataset][] = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [
    f,
    FixtureDatasetSchema.parse(JSON.parse(readFileSync(new URL(f, FIXTURES), 'utf8'))),
  ]);

describe('FIX_SUBJECT', () => {
  it.each(FixTypeSchema.options)('gives %s a subject the contract defines', (type) => {
    expect(ChangeSubjectSchema.options).toContain(FIX_SUBJECT[type]);
  });

  it('follows the section where it aligns, and narrows only orphan_pages to orphans', () => {
    const SECTION_SUBJECT = {
      crawler_access: 'crawler_access',
      without_js: 'text_without_js',
      structure: 'structure',
      content: 'content',
    } as const;
    const narrowed = FixTypeSchema.options.filter(
      (t) => FIX_SUBJECT[t] !== SECTION_SUBJECT[FIX_SECTION[t]],
    );
    expect(narrowed).toEqual(['orphan_pages']);
    expect(FIX_SUBJECT.orphan_pages).toBe('orphans');
  });

  it('has no entry for anything that is not a fix type', () => {
    expect(Object.keys(FIX_SUBJECT).sort()).toEqual([...FixTypeSchema.options].sort());
    expect(Object.keys(FIX_SECTION).sort()).toEqual([...FixTypeSchema.options].sort());
    expect(Object.keys(COVERAGE_DEPENDENCE).sort()).toEqual([...FixTypeSchema.options].sort());
  });
});

describe('FIX_SECTION', () => {
  it('agrees with the section of every fix in the CC-11 fixtures', () => {
    const fixes = datasets.flatMap(([, d]) => d.fixes);
    expect(fixes.length).toBeGreaterThan(0);
    for (const f of fixes) expect(FIX_SECTION[f.type], f.type).toBe(f.section);
  });
});
