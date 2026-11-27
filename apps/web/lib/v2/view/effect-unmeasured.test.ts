/**
 * F-274 (D-11): a fix whose AI effect waits on a measurement the product does not take yet
 * (`readable_unmeasured`, `quotable_unmeasured`, `signals_unmeasured` in its
 * `ai_readability_pending_on`) has no AI value to show, so its effect column says nothing of AI:
 * its Technical SEO figure when it has one, else nothing. Production held this shape on every fix
 * (A2's read, 25 Nov). Where the AI effect is missing for this check alone (too few crawlers
 * measured, a content check not scored) or waits on another fix, the wording stays.
 */
import type { Fix } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { AI_WAITING, effectHeadline } from './effect-headline';
import { points, restPoints } from './result';
import { effectOf, groupPoints, proPoints } from './segment/fixes';

const d = fixture('bad-site');
const base = d.fixes.find((f) => f.section === 'content')!;
const other = d.fixes.find((f) => f.id !== base.id)!;

const fixWith = (
  pending: Fix['effect']['ai_readability_pending_on'],
  seo: number | null,
  section: Fix['section'] = 'content',
): Fix => ({
  ...base,
  section,
  type: 'quotable_opening',
  effect: {
    ...base.effect,
    technical_seo: seo,
    ai_readability: null,
    ai_readability_pending_on: pending,
  },
});
const all = [other];

describe('a fix whose AI effect waits on an unmeasured part', () => {
  it.each([
    [['readable_unmeasured', 'quotable_unmeasured'], 0],
    [['quotable_unmeasured'], 0],
    [['signals_unmeasured'], null],
    [['readable_unmeasured', 'quotable_unmeasured', 'check_not_scored'], 0],
    [[other.fingerprint, 'quotable_unmeasured'], 0],
  ] as const)('pending %j with SEO %s shows nothing', (pending, seo) => {
    const f = fixWith([...pending], seo);
    expect(effectHeadline(f, all)).toEqual({ kind: 'none' });
    expect(points(f, all)).toBe('');
    expect(proPoints(f, all)).toBe('');
    expect(effectOf(f, all)).toEqual({ points: '', unit: '' });
  });

  it('in an AI section, shows nothing even with a Technical SEO figure (owner ruling, 2026-11-05)', () => {
    const f = fixWith(['quotable_unmeasured'], 0.67, 'content');
    expect(points(f, all)).toBe('');
  });

  it('outside an AI section, shows its Technical SEO figure when it has one', () => {
    const f = fixWith(['quotable_unmeasured'], 0.67, 'structure');
    expect(points(f, all)).toBe('+0.67 SEO');
    expect(proPoints(f, all)).toBe('+0.67 Technical SEO');
  });

  it('outside an AI section, says nothing at 0 and "SEO not estimated" when that is missing', () => {
    expect(points(fixWith(['quotable_unmeasured'], 0, 'structure'), all)).toBe('');
    expect(points(fixWith(['quotable_unmeasured'], null, 'structure'), all)).toBe(
      'SEO not estimated',
    );
  });

  it('a group of such fixes says nothing; beside a fix that waits for this check, counts that one', () => {
    const a = fixWith(['readable_unmeasured'], 0);
    const b = fixWith(['quotable_unmeasured'], 0);
    const c = fixWith(['too_few_crawlers_measured'], 0);
    expect(restPoints([a, b])).toBe('');
    expect(groupPoints([a, b])).toBe('');
    expect(restPoints([a, b, c])).toBe('AI not yet estimated for 1');
    expect(groupPoints([a, b, c])).toBe('No measurable effect; AI effect not yet estimated for 1');
  });
});

describe('a fix whose AI effect is missing for this check, or waits on another fix, keeps its words', () => {
  it.each([
    [['too_few_crawlers_measured'], 'AI not yet estimated'],
    [['check_not_scored'], 'AI not yet estimated'],
    [['crawler_too_few_pages'], 'AI not yet estimated'],
  ] as const)('pending %j reads %s', (pending, text) => {
    expect(points(fixWith([...pending], 0), all)).toBe(text);
  });

  it('waiting on another fix names it', () => {
    expect(points(fixWith([other.fingerprint], 0), all)).toBe(`AI after fix ${other.number}`);
  });
});

describe('the site page’s main button, for a fix with nothing to show', () => {
  it('names the fix alone, with no trailing separator', async () => {
    const { siteView } = await import('./site');
    const ds = structuredClone(d);
    const site = '50000000-0000-4000-8000-000000000001';
    for (const f of ds.fixes) {
      f.effect.ai_readability = null;
      f.effect.ai_readability_pending_on = ['readable_unmeasured', 'quotable_unmeasured'];
      f.effect.technical_seo = 0;
    }
    const v = siteView(
      ds,
      { accountId: 'a0000000-0000-4000-8000-000000000001', now: ds.as_of },
      site,
    );
    const labels = v.header.actions.map((a) => a.label);
    const primary = labels.find((l) => /^Open (fix \d+|the .* packet)$/.test(l));
    expect(primary).toBeDefined();
    expect(labels.some((l) => l.endsWith(' · '))).toBe(false);
  });
});

describe('precedence, with an unmeasured part co-pending (review #7)', () => {
  // A reason the site's own state gives, which withholds the grade itself, keeps its words: it is
  // true and the owner can act on it whatever else is unmeasured.
  it.each([
    [['quotable_unmeasured', 'too_few_crawlers_measured'], 'too_few_crawlers_measured'],
    [['readable_unmeasured', 'blocked_by_choice'], 'blocked_by_choice'],
  ] as const)('%j keeps the words of %s', (pending, reason) => {
    const f = fixWith([...pending], 0);
    expect(points(f, all)).toBe('AI not yet estimated');
    expect(effectOf(f, all).unit).toBe(AI_WAITING[reason]);
  });

  // A fix's own reason, or a wait on another fix, cannot end the wait while a part is unmeasured.
  it.each([
    [['readable_unmeasured', 'quotable_unmeasured', 'check_not_scored']],
    [['quotable_unmeasured', 'crawler_too_few_pages']],
  ] as const)('%j says nothing', (pending) => {
    expect(points(fixWith([...pending], 0), all)).toBe('');
  });
});
