import { describe, expect, it } from 'vitest';
import { fixesAsOf } from '../../fixtures';
import { FREE_FIXES } from '../free-fixes';
import { noPacketLine } from '../no-packet';
import { noPacketReason } from '../packet-reason';
import { bodyFor, seeFor, withBodies, withSee } from '../test-support/multi-body';
import { RECOMMENDATION_LABELS, packetBodies, packetPrompt, sectionFixes } from './fixes';
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

  it('shows the body of the packet’s own framework, and copies that body, when the packet holds several', () => {
    const { d, check } = edited('bad-site', (_c, ds) => {
      const f = ds.fixes.find((x) => x.type === 'edge_rule_blocks_crawler' && x.packet)!;
      f.packet = withBodies(f.packet!, ['wordpress', 'nextjs']);
    });
    const [f] = sectionFixes(d, check, 'crawler_access').open;
    const stored = d.fixes.find((x) => x.id === f!.id)!;
    expect(f!.notWritten).toBeNull();
    expect(f!.packet).toContain(stored.packet!.change[0]);
    expect(f!.prompt).toBe(packetPrompt(stored, packetBodies(stored.packet!)[0]!));
    for (const other of ['wordpress', 'nextjs'] as const) {
      expect(f!.packet).not.toContain(bodyFor(other).change[0]);
      expect(f!.prompt).not.toContain(bodyFor(other).change[0]);
    }
  });

  it('shows “See it” above “Exact check” for a packet with a readable command, from its own body', () => {
    const { d, check } = edited('bad-site', (_c, ds) => {
      const f = ds.fixes.find((x) => x.type === 'edge_rule_blocks_crawler' && x.packet)!;
      f.packet = withSee(withBodies(f.packet!, ['wordpress']));
    });
    const [f] = sectionFixes(d, check, 'crawler_access').open;
    const stored = d.fixes.find((x) => x.id === f!.id)!.packet!;
    const see = seeFor(stored.framework);
    const lines = f!.packet!.split('\n');
    const verify = lines.filter((_, i) => i >= lines.findIndex((l) => l.startsWith('Verify')));
    expect(verify).toEqual([
      'Verify (we run the exact check after you mark done):',
      'See it (a short command that prints the evidence; it decides nothing):',
      `  ${see.command}`,
      `  Today: ${see.today}`,
      `  After the fix: ${see.after}`,
      'Exact check (this command decides whether the fix has landed):',
      `  ${stored.verify.command}`,
      `  → expect ${stored.verify.expect}`,
    ]);
    // The prompt ends with the same lines; the other body's readable command is in neither.
    expect(f!.prompt!.split('\n').filter((_, i, all) => i >= all.length - verify.length)).toEqual(
      verify,
    );
    for (const s of Object.values(seeFor('wordpress'))) {
      expect(f!.packet).not.toContain(s);
      expect(f!.prompt).not.toContain(s);
    }
  });

  it('shows a packet without a readable command as before: the one command and what to expect', () => {
    const { d, check } = edited('bad-site');
    const [f] = sectionFixes(d, check, 'crawler_access').open;
    const stored = d.fixes.find((x) => x.id === f!.id)!.packet!;
    expect(stored.verify.see).toBeNull();
    const lines = f!.packet!.split('\n');
    expect(lines.filter((_, i) => i >= lines.length - 3)).toEqual([
      'Verify (we run this after you mark done):',
      `  ${stored.verify.command}`,
      `  → expect ${stored.verify.expect}`,
    ]);
    expect(f!.packet).not.toMatch(/See it|Exact check|After the fix:/);
  });

  it('says why an open fix has no packet, in the packet’s place', () => {
    const { d, check } = edited('bad-site', (_c, ds) => {
      for (const f of ds.fixes) f.packet = null;
    });
    const [f] = sectionFixes(d, check, 'crawler_access').open;
    const stored = d.fixes.find((x) => x.id === f!.id)!;
    expect(f).toMatchObject({ paragraph: [], packet: null, handoff: null, prompt: null });
    expect(f!.notWritten).toBe(noPacketLine(noPacketReason(stored.type)));
  });

  it('lists a packet’s bodies, its own first, and none for a framework it only lists', () => {
    const { d } = edited('bad-site');
    const p = d.fixes.find((x) => x.packet)!.packet!;
    expect(p.frameworks.length).toBeGreaterThan(1);
    expect(packetBodies(p).map((b) => b.framework)).toEqual([p.framework]);
    const others = (['wordpress', 'nextjs', 'webflow'] as const).filter((f) => f !== p.framework);
    expect(packetBodies(withBodies(p, others)).map((b) => b.framework)).toEqual([
      p.framework,
      ...others,
    ]);
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
    expect(rest.recommendations.map((r) => [r.label, r.count])).toEqual([
      ['confirmed defect', 2],
      ['documented platform requirement', 1],
      ['supported best practice', 2],
    ]);
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

  it('with no effect estimated on either grade, says so', () => {
    const { d, check } = edited('bad-site', (_, ds) => {
      for (const f of ds.fixes) {
        f.effect.technical_seo = null;
        f.effect.technical_seo_pending_on = ['grade_refused'];
        f.effect.ai_readability = null;
        f.effect.ai_readability_pending_on = ['readable_unmeasured'];
      }
    });
    const rest = sectionFixes(d, check, 'structure').pro.at(-1)!;
    expect(rest.points).toBe(
      `no estimated effect; Technical SEO effect not estimated for ${rest.count}; AI effect not yet estimated for ${rest.count}`,
    );
  });

  it('on a refused grade, counts the fixes whose Technical SEO effect is not estimated, and shows no +0', () => {
    const { d, check } = edited('bad-site', (_, ds) => {
      for (const f of ds.fixes) {
        f.effect.technical_seo = null;
        f.effect.technical_seo_pending_on = ['grade_refused'];
      }
    });
    const rest = sectionFixes(d, check, 'structure').pro.at(-1)!;
    // their AI effects are estimated, at 0 on these fixtures: no measurable effect (CC-32 D4)
    expect(rest.points).toBe(
      `No measurable effect; Technical SEO effect not estimated for ${rest.count}`,
    );
  });
});
