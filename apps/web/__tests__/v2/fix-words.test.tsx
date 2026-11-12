/**
 * The fix page's own words (CC-30 owner rulings 2 and 3): a count of one takes the singular, and
 * no enum value or key of the contract is printed where a reader expects words.
 *
 * What is scanned is the text the web writes: the page as rendered, without the packet's strings
 * (the engine's, or a fixture author's; `packages/engine/src/v2/packets` tests its own) and without
 * crawled values (a URL, a template key). A packet string can hold what a developer types, such as
 * a vendor's `http.user_agent`, and a command holds what it needs.
 */
import fc from 'fast-check';
import type { Fix } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { switchedTo } from '../../components/v2/screens/fix/FrameworkSwitch';
import { FixScreen } from '../../components/v2/screens/fix/FixScreen';
import { fixesAsOf, fixture } from '../../lib/v2/fixtures';
import { oneLine } from '../../lib/v2/packet-text';
import {
  fixView,
  FRAMEWORK_LABELS,
  type FixView,
  type PacketFramework,
} from '../../lib/v2/view/fix';
import {
  FOUND_ABOVE,
  NO_STEPS_FOR_TYPE,
  NOT_WRITTEN_BY_CHECK,
  noPacketLine,
} from '../../lib/v2/view/no-packet';
import { noPacketReason } from '../../lib/v2/view/packet-reason';
import { effortText, openFix, sectionFixes } from '../../lib/v2/view/segment/fixes';
import { edited, FIRST_AUDIT } from '../../lib/v2/view/segment/test-helpers';
import {
  everyPacketString,
  parsed,
  withBodies,
  withSee,
} from '../../lib/v2/view/test-support/multi-body';

/** A word with an underscore between letters: the shape of the contract's enum values and keys. */
const IDENTIFIER = /[a-z]+_[a-z_]+/g;
/** "1 pages": a count of one before a plural. "1 is" and "1 of 6" are not counts of a noun. */
const ONE_OF_MANY = /(?<![\d,.])1 (?!is\b|of\b)[a-z]+s\b/g;

const FIXTURES = ['bad-site', 'built-site', 'challenged-site'] as const;
const FRAMEWORKS = Object.keys(FRAMEWORK_LABELS) as PacketFramework[];

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');

/** The page of `view` as text, without `f`'s packet strings and without URLs and its template key. */
function ownText(view: FixView, f: Fix): string {
  let text = textOf(renderToStaticMarkup(<FixScreen data={view} />));
  const theirs = [...(f.packet ? everyPacketString(f.packet).map(oneLine) : []), f.template_key]
    .filter((s): s is string => Boolean(s))
    .sort((a, b) => b.length - a.length);
  for (const s of theirs) text = text.split(s).join(' ');
  return text.replace(/https?:\/\/\S+/g, ' ');
}

/** Every page the three fixtures give: each live fix of each finished check, on Free and on Pro. */
function* fixturePages(): Generator<{ name: string; text: string }> {
  for (const fixtureName of FIXTURES) {
    const d = fixture(fixtureName);
    for (const check of d.checks.filter((c) => c.finished_at !== null)) {
      for (const f of fixesAsOf(d, check)) {
        for (const plan of ['free', 'pro'] as const) {
          yield {
            name: `${fixtureName}, check ${check.id}, fix ${f.number}, ${plan}`,
            text: ownText(fixView(d, check.id, f.id, { plan }), f),
          };
        }
      }
    }
  }
}

/** The bad site's fix 2 with `edit` applied, opened as it was first seen. */
function fix2(edit: (f: Fix, d: ReturnType<typeof edited>['d']) => void) {
  const { d } = edited('bad-site');
  const f = d.fixes.find((x) => x.number === 2 && x.site_id === d.fixes[0]!.site_id)!;
  edit(f, d);
  const view = fixView(d, FIRST_AUDIT['bad-site'], f.id, { asFirstSeen: true });
  return { f, view, text: ownText(view, f) };
}

describe('the fix page prints no enum value or key', () => {
  it('on any page of the three fixtures, outside the packet’s strings and crawled values', () => {
    let pages = 0;
    for (const page of fixturePages()) {
      pages += 1;
      expect(page.text.match(IDENTIFIER) ?? [], page.name).toEqual([]);
    }
    // The scan read pages: the three fixtures hold more than twenty live fixes between them.
    expect(pages).toBeGreaterThan(40);
  });

  it('finds one when the page holds one (the scan is live)', () => {
    const { text } = fix2((f) => {
      f.title = 'Server-render the product_template';
    });
    expect(text.match(IDENTIFIER)).toEqual(['product_template']);
  });

  it('names each framework in words: the switch, what a choice says, and which stack a body is for', () => {
    for (const own of FRAMEWORKS) {
      const others = FRAMEWORKS.filter((k) => k !== own);
      const { f, view, text } = fix2((x) => {
        x.packet = parsed({
          ...x,
          packet: withSee(withBodies({ ...x.packet!, framework: own }, others)),
        }).packet;
      });
      if (view.kind !== 'open' || !view.packet || !view.switcher) throw new Error('no switch');
      expect(view.switcher.options.map((o) => o.key)).toEqual([own, ...others]);
      expect(text.match(IDENTIFIER) ?? [], own).toEqual([]);
      const said = [
        view.switcher.heading,
        view.switcher.detected,
        ...view.switcher.options.flatMap((o) => [o.label, switchedTo(o)]),
        ...view.packet.bodies.map((b) => b.stack),
      ];
      for (const s of said) expect(s.match(IDENTIFIER) ?? [], s).toEqual([]);
      // The prompt adds no key of its own to the body's strings: without them, none is left.
      for (const body of view.packet.bodies) {
        let prompt = body.prompt;
        for (const s of everyPacketString(f.packet!).sort((a, b) => b.length - a.length)) {
          prompt = prompt.split(s).join(' ');
        }
        expect(prompt.match(IDENTIFIER) ?? [], `${body.key} prompt`).toEqual([]);
      }
    }
    // The two framework keys that hold an underscore are among those shown.
    expect(FRAMEWORKS.filter((k) => k.includes('_'))).toEqual([
      'shopify_liquid',
      'shopify_hydrogen',
    ]);
  });

  it('says why a fix has no packet in words of its own, around the engine’s reason', () => {
    // The reason for a type with no builder is the engine's sentence (its registry), printed as
    // written; the web's words around it, and the whole line for a type with a builder, are scanned.
    for (const s of [NOT_WRITTEN_BY_CHECK, NO_STEPS_FOR_TYPE, FOUND_ABOVE, noPacketLine(null)]) {
      expect(s.match(IDENTIFIER) ?? [], s).toEqual([]);
    }
    const types = new Set<string>();
    for (const fixtureName of FIXTURES) {
      const d = structuredClone(fixture(fixtureName));
      for (const f of d.fixes) f.packet = null;
      for (const check of d.checks.filter((c) => c.finished_at !== null)) {
        for (const f of fixesAsOf(d, check)) {
          const view = fixView(d, check.id, f.id, { plan: 'pro' });
          if (view.kind !== 'open') throw new Error(view.kind);
          types.add(f.type);
          const reason = noPacketReason(f.type);
          expect(view.notWritten).toBe(noPacketLine(reason));
          const text = ownText(view, f);
          const ours = reason === null ? text : text.split(reason).join(' ');
          expect(ours.match(IDENTIFIER) ?? [], f.type).toEqual([]);
        }
      }
    }
    expect(types.size).toBeGreaterThan(8);
  });
});

describe('a count of one takes the singular', () => {
  it('on any page of the three fixtures', () => {
    for (const page of fixturePages()) {
      expect(page.text.match(ONE_OF_MANY) ?? [], page.name).toEqual([]);
    }
  });

  it('finds “1 pages” when a page holds it, and not “fix 1 is” or “1 of 6” (the scan is live)', () => {
    expect('all 1 pages; 1 minutes'.match(ONE_OF_MANY)).toEqual(['1 pages', '1 minutes']);
    expect(
      'once fix 1 is also fixed; 1 of 6 crawlers; 11 pages; 2,001 pages'.match(ONE_OF_MANY),
    ).toBeNull();
  });

  it('pages: one page is “the page”, two are “the 2 pages” and “all 2 pages”', () => {
    const at = (n: number) => {
      const { view, text } = fix2((f) => {
        f.affected_pages = n;
      });
      if (view.kind !== 'open' || !view.packet || !view.shipped) throw new Error(view.kind);
      return {
        last: view.packet.bodies[0]!.block.split('\n').at(-1),
        body: view.shipped.body,
        text,
      };
    };
    expect(at(1).last).toBe('  We run this when you mark the fix done.');
    expect(at(1).body).toContain('we re-crawl the page now');
    expect(at(2).last).toBe('  We run this on all 2 pages when you mark the fix done.');
    expect(at(2).body).toContain('we re-crawl the 2 pages now');
    for (const n of [1, 2]) expect(at(n).text.match(ONE_OF_MANY) ?? [], String(n)).toEqual([]);
  });

  it('pages, under a readable command: “the exact check” runs on the page, or on all 2 pages', () => {
    const last = (n: number) => {
      const { view } = fix2((f) => {
        f.affected_pages = n;
        f.packet = withSee(f.packet!);
      });
      if (view.kind !== 'open' || !view.packet) throw new Error(view.kind);
      return view.packet.bodies[0]!.block.split('\n').at(-1);
    };
    expect(last(1)).toBe('  We run the exact check when you mark the fix done.');
    expect(last(2)).toBe('  We run the exact check on all 2 pages when you mark the fix done.');
  });

  it('templates, deploys and minutes, in the effort tile and the segment’s open fix', () => {
    const templates = (templates: number, deploys: number) =>
      effortText({ effort: { kind: 'templates', templates, deploys } });
    expect(templates(1, 1)).toBe('one template, one deploy');
    expect(templates(2, 1)).toBe('two templates, one deploy');
    expect(templates(1, 2)).toBe('one template, two deploys');
    expect(templates(2, 2)).toBe('two templates, two deploys');
    expect(effortText({ effort: { kind: 'minutes', minutes: 1 } })).toBe('about 1 minute');
    expect(effortText({ effort: { kind: 'minutes', minutes: 2 } })).toBe('about 2 minutes');
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }), (a, b) => {
        for (const said of [
          effortText({ effort: { kind: 'templates', templates: a, deploys: b } })!,
          effortText({ effort: { kind: 'minutes', minutes: a } })!,
        ]) {
          expect(said).not.toMatch(/\b(1|one) (templates|deploys|minutes)\b/);
          expect(said).not.toMatch(/\b(?!1\b|one\b)[\w,]+ (template|deploy|minute)\b/);
        }
      }),
    );
    // The fix page's tile and the segment's open fix print the same words.
    const { view, f } = fix2((x) => {
      x.effort = { kind: 'minutes', minutes: 1 };
    });
    expect(view.head.tiles.find((t) => t.label === 'Effort')!.value).toBe('about 1 minute');
    expect(openFix(f, [f]).effort).toBe('about 1 minute');
  });

  it('fixes: the footnote names “fix 1” or “fixes 1 and 4”, with “is” or “are”', () => {
    const footnote = (lettingIn: number[]) => {
      const { view } = fix2((_f, d) => {
        // The two AI crawlers kept out today are let in by fix 1; give the second to each of
        // `lettingIn` so one fix, or two, account for them.
        const first = d.fixes.find((x) => x.number === 1 && x.site_id === _f.site_id)!;
        const out = [...first.crawler_uas];
        for (const x of d.fixes.filter((y) => y.site_id === _f.site_id && y.id !== _f.id)) {
          x.crawler_uas = x.crawler_uas.filter((ua) => !out.includes(ua));
        }
        lettingIn.forEach((n, i) => {
          const x = d.fixes.find((y) => y.number === n && y.site_id === _f.site_id)!;
          x.crawler_uas = lettingIn.length === 1 ? out : [out[i % out.length]!];
        });
      });
      return view.beforeAfter!.footnote;
    };
    expect(footnote([1])).toBe('* 6 of 6 once fix 1 in Crawler access is also fixed.');
    expect(footnote([1, 4])).toMatch(/^\* 6 of 6 once fixes 1 and 4 in .+ are also fixed\.$/);
  });

  it('fixes: a Pro row’s effect waits on “fix 1” or on “fixes 1 and 2”', () => {
    const waits = (numbers: number[]) => {
      const { d, check } = edited('bad-site', (_c, ds) => {
        const site = ds.fixes[0]!.site_id;
        const mine = ds.fixes.filter((x) => x.site_id === site);
        const f = mine.find((x) => x.number === 5)!;
        f.effect = {
          ...f.effect,
          ai_readability: null,
          ai_readability_pending_on: numbers.map(
            (n) => mine.find((x) => x.number === n)!.fingerprint,
          ),
        };
      });
      const five = d.fixes.find((x) => x.number === 5 && x.site_id === d.fixes[0]!.site_id)!;
      return (['crawler_access', 'without_js', 'structure', 'content'] as const)
        .flatMap((s) => sectionFixes(d, check, s).pro)
        .filter((r) => r.key === five.id)
        .map((r) => r.points);
    };
    expect(waits([1])).toEqual([expect.stringMatching(/; AI effect estimated after fix 1$/)]);
    expect(waits([1, 2])).toEqual([
      expect.stringMatching(/; AI effect estimated after fixes 1 and 2$/),
    ]);
  });
});
