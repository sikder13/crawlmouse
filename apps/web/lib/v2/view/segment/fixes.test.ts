import { describe, expect, it } from 'vitest';
import { fixesAsOf } from '../../fixtures';
import { FREE_FIXES } from '../result';
import { RECOMMENDATION_LABELS, sectionFixes } from './fixes';
import { edited } from './test-helpers';

describe('sectionFixes', () => {
  it('opens the section’s fixes among the audit’s first three, and puts the rest on Pro', () => {
    const { d, check } = edited('bad-site');
    const access = sectionFixes(d, check, 'crawler_access');
    expect(access.summary).toBe('1 open');
    expect(access.open.map((f) => f.title)).toEqual([
      'Let GPTBot and PerplexityBot through Cloudflare',
    ]);
    const structure = sectionFixes(d, check, 'structure');
    expect(structure.summary).toBe('1 open · 7 on Pro');
    const content = sectionFixes(d, check, 'content');
    expect(content.summary).toBe('0 open · 3 on Pro');
  });

  it('agrees with the audit-wide split: every section’s open and Pro counts add up to it', () => {
    for (const name of ['bad-site', 'challenged-site'] as const) {
      const { d, check } = edited(name);
      const all = fixesAsOf(d, check);
      const sections = (['crawler_access', 'without_js', 'structure', 'content'] as const).map(
        (s) => sectionFixes(d, check, s),
      );
      expect(sections.reduce((n, s) => n + s.open.length, 0)).toBe(
        Math.min(FREE_FIXES, all.length),
      );
      expect(sections.reduce((n, s) => n + s.proCount, 0)).toBe(
        Math.max(0, all.length - FREE_FIXES),
      );
    }
  });

  it('names up to three Pro fixes and groups the rest, with their points summed', () => {
    const { d, check } = edited('bad-site');
    const s = sectionFixes(d, check, 'structure');
    expect(s.pro.map((p) => [p.title, p.points])).toEqual([
      ['Replace the generic anchor text on 6 pages', '+2 Technical SEO'],
      ['Bring 3 pages within three clicks of the homepage', '+1 Technical SEO'],
      ['5 more structure fixes', '+2 Technical SEO together'],
    ]);
    expect(s.pro[2]!.count).toBe(5);
    expect(s.pro[2]!.scope).toBe(
      'make the JavaScript-only navigation crawlable on 5 pages, fix two canonical mismatches, shorten a redirect chain, consolidate duplicate pagination and close one hreflang gap',
    );
  });

  it('says what an effect waits on instead of inventing one (I11)', () => {
    const { d, check } = edited('bad-site');
    expect(sectionFixes(d, check, 'content').pro.map((p) => p.points)).toEqual([
      '+1 Technical SEO; AI effect estimated after fixes 1 and 2',
      '+1 Technical SEO; AI effect estimated after fixes 1 and 2',
      '+1 Technical SEO; AI effect estimated after fixes 1 and 2',
    ]);
  });

  it('builds the open fix from its packet: effect, effort, class and the steps', () => {
    const { d, check } = edited('bad-site');
    const [f] = sectionFixes(d, check, 'crawler_access').open;
    expect(f).toMatchObject({
      points: '+24',
      unit: 'AI readability, estimated',
      effort: 'about 10 minutes',
      recommendation: { cls: 'confirmed_defect', label: 'confirmed defect' },
    });
    expect(f!.paragraph).toEqual([
      'GPTBot is refused by a Cloudflare firewall rule (error 1020) on every page; PerplexityBot is served a Bot Fight Mode challenge instead of your content.',
    ]);
    expect(f!.packet).toContain('Verify (we run this after you mark done):');
    expect(f!.prompt).toContain('Site: example-outfitter.com');
  });

  it('labels every recommendation class', () => {
    expect(Object.keys(RECOMMENDATION_LABELS).sort()).toEqual(
      ['best_practice', 'confirmed_defect', 'documented_requirement', 'experimental'].sort(),
    );
  });

  it('says there is nothing to fix in a section without fixes', () => {
    const { d, check } = edited('clean-site');
    expect(sectionFixes(d, check, 'structure')).toMatchObject({
      summary: 'nothing to fix',
      open: [],
      pro: [],
    });
  });
});

describe('sectionFixes: a row that groups several fixes', () => {
  it('names the class of every fix it stands for, counted, in the contract’s order', () => {
    const { d, check } = edited('bad-site');
    const rest = sectionFixes(d, check, 'structure').pro.at(-1)!;
    expect(rest.recommendations.map((r) => [r.label, r.count])).toEqual(
      [
        ['confirmed defect', 2],
        ['supported best practice', 2],
        ['documented platform requirement', 1],
      ].sort(
        (a, b) =>
          [
            'confirmed defect',
            'documented platform requirement',
            'supported best practice',
          ].indexOf(a[0] as string) -
          [
            'confirmed defect',
            'documented platform requirement',
            'supported best practice',
          ].indexOf(b[0] as string),
      ),
    );
    expect(rest.recommendations.reduce((n, r) => n + r.count, 0)).toBe(rest.count);
  });

  it('sums both grades’ points, and counts the fixes whose AI effect waits', () => {
    const { d, check } = edited('bad-site', (_, ds) => {
      const named = ds.fixes.filter((f) => f.title.startsWith('Close one hreflang'));
      named[0]!.effect.ai_readability = 3;
      ds.fixes.find((f) => f.title.startsWith('Shorten a redirect'))!.effect.ai_readability = null;
    });
    expect(sectionFixes(d, check, 'structure').pro.at(-1)!.points).toBe(
      '+2 Technical SEO, +3 AI readability together; AI effect not yet estimated for 1',
    );
  });
});
