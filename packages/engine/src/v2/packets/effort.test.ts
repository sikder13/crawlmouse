import { EffortSchema, FixTypeSchema, type FixType } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { CONTENT_CHECKS } from '../content/checks.js';
import type { FixRecord } from '../grade/effects.js';
import { EFFORT_RULES, effortOf } from './effort.js';
import { accessRecord, contentRecord, structureRecord } from './test-support/records.js';

const ONE_TEMPLATE = { kind: 'templates', templates: 1, deploys: 1 };

/** The fix types whose record names one template: the content checks' fixes and the two template fixes. */
const TEMPLATE_TYPES: FixType[] = [
  ...Object.values(CONTENT_CHECKS).flatMap((c) => (c.fix === null ? [] : [c.fix])),
  'duplicate_pagination',
  'client_rendered_template',
];

describe('EFFORT_RULES', () => {
  it('has a rule for each fix type, and for nothing else', () => {
    expect(Object.keys(EFFORT_RULES).sort()).toEqual([...FixTypeSchema.options].sort());
    for (const type of FixTypeSchema.options) {
      expect(EFFORT_RULES[type].rule.length, type).toBeGreaterThan(20);
    }
  });

  it('states one template and one deploy for the types whose record names one template, and no effort for the rest', () => {
    for (const type of FixTypeSchema.options) {
      expect(EFFORT_RULES[type].effort, type).toEqual(
        TEMPLATE_TYPES.includes(type) ? ONE_TEMPLATE : null,
      );
    }
    // Seven types, counted by hand: five content checks, pagination, the client-rendered template.
    expect(TEMPLATE_TYPES).toHaveLength(7);
  });

  it('states no number of minutes: no record holds a measure of time', () => {
    const kinds = FixTypeSchema.options.map((t) => EFFORT_RULES[t].effort?.kind ?? null);
    expect(kinds.filter((k) => k === 'minutes')).toEqual([]);
  });

  it('each effort it states is one the contract accepts', () => {
    for (const type of FixTypeSchema.options) {
      const { effort } = EFFORT_RULES[type];
      if (effort !== null) expect(EffortSchema.safeParse(effort).success, type).toBe(true);
    }
  });
});

describe('effortOf', () => {
  it('a content fix names one template: one template, one deploy', () => {
    for (const check of Object.keys(CONTENT_CHECKS) as (keyof typeof CONTENT_CHECKS)[]) {
      const fix: FixRecord = { family: 'content', record: contentRecord(check) };
      expect(effortOf(fix), check).toEqual(ONE_TEMPLATE);
    }
  });

  it('duplicate pagination names one template: one template, one deploy', () => {
    const fix: FixRecord = { family: 'structure', record: structureRecord('duplicate_pagination') };
    expect(effortOf(fix)).toEqual(ONE_TEMPLATE);
  });

  it('a fix of one page or one rule has no effort: its record holds nothing to estimate from', () => {
    for (const type of [
      'orphan_pages',
      'deep_pages',
      'generic_anchor_text',
      'redirect_chain',
      'canonical_mismatch',
      'hreflang_gap',
    ] as const) {
      expect(effortOf({ family: 'structure', record: structureRecord(type) }), type).toBeNull();
    }
    expect(effortOf({ family: 'access', record: accessRecord() })).toBeNull();
  });

  it('reads the rule of the record’s own type, whatever the family', () => {
    for (const type of FixTypeSchema.options) {
      const fix = { family: 'structure', record: structureRecord(type) } as FixRecord;
      expect(effortOf(fix), type).toEqual(EFFORT_RULES[type].effort);
    }
  });
});
