import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FixPreview } from '../../app/(v2-preview)/v2-preview/_preview/FixPreview';
import {
  FIX_SOURCES,
  fixIdOf,
  fixPreview,
  type FixVariant,
} from '../../app/(v2-preview)/v2-preview/_preview/fixes';
import { PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/registry';
import { RESULT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import { SEGMENT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { FixScreen } from '../../components/v2/screens/fix/FixScreen';
import { findCheck, fixture } from '../../lib/v2/fixtures';
import { fixView, type FixPlan } from '../../lib/v2/view/fix';
import {
  everyPacketString,
  seeFor,
  withBodies,
  withSee,
} from '../../lib/v2/view/test-support/multi-body';
import type { ResultView } from '../../lib/v2/view/result';
import { holds } from './_lib/holds';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const VARIANTS = Object.keys(FIX_SOURCES) as FixVariant[];
const html = (v: FixVariant) => renderToStaticMarkup(<FixPreview variant={v} />);
const fixOf = (v: FixVariant) => {
  const s = FIX_SOURCES[v];
  return fixture(s.fixture).fixes.find((f) => f.id === fixIdOf(v))!;
};

describe('Final-Fix, fix 2 of the bad site', () => {
  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Fix.dc.html')).rest, 'fix'),
        renderedText(withoutShell(html('bad-site')).rest),
      ),
    ).toBeNull();
  });
});

describe.each(VARIANTS)('the fix page, %s', (variant) => {
  const markup = html(variant);
  const entry = PREVIEWS.find((p) => p.path === FIX_SOURCES[variant].path)!;

  it('is listed, with as many orange elements as its entry says', () => {
    expect(entry).toBeDefined();
    const primaries = markup.match(/data-v2-primary=""/g) ?? [];
    expect(primaries).toHaveLength(entry.orange ?? 1);
  });

  it('has one heading of the first level, the fix’s title', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup.replace(/&#x27;/g, "'")).toContain(fixOf(variant).title);
  });
});

describe('the Pro wall', () => {
  const markup = html('locked');
  const p = fixOf('locked').packet!;

  it('puts none of the packet in the page', () => {
    expect(p).not.toBeNull();
    const lines = [...p.context, ...p.change, ...p.keep, p.verify.command, p.verify.expect];
    expect(lines.some((l) => /["']/.test(l))).toBe(true);
    for (const s of lines) expect(holds(markup, s), s).toBe(false);
    // The control: the open fix's page holds its packet, found the same way.
    const open = html('bad-site');
    const q = fixOf('bad-site').packet!;
    for (const s of [...q.context, ...q.change, ...q.keep, q.verify.command]) {
      expect(holds(open, s), s).toBe(true);
    }
  });

  it('puts no body of a locked fix that holds several in the page', () => {
    const d = structuredClone(fixture('bad-site'));
    const f = d.fixes.find((x) => x.id === fixIdOf('locked'))!;
    f.packet = withBodies(f.packet!, ['wordpress', 'generic']);
    const { check, asFirstSeen } = FIX_SOURCES.locked;
    const page = (plan: FixPlan) =>
      renderToStaticMarkup(<FixScreen data={fixView(d, check, f.id, { asFirstSeen, plan })} />);
    const lines = everyPacketString(f.packet);
    expect(lines).toHaveLength(everyPacketString(p).length + 2 * 6);
    const locked = page('free');
    expect(locked).toContain('See this fix with Pro');
    for (const s of lines) expect(holds(locked, s), s).toBe(false);
    // The control: on Pro the page opens on the packet's own body and offers the other two.
    const open = page('pro');
    for (const s of [...p.change, p.verify.command]) expect(holds(open, s), s).toBe(true);
    expect(open).toMatch(/aria-pressed="false"[^>]*>WordPress</);
  });

  it('puts none of a locked fix’s readable command in the page, for any of its bodies', () => {
    const d = structuredClone(fixture('bad-site'));
    const f = d.fixes.find((x) => x.id === fixIdOf('locked'))!;
    f.packet = withSee(withBodies(f.packet!, ['wordpress', 'generic']));
    const { check, asFirstSeen } = FIX_SOURCES.locked;
    const page = (plan: FixPlan) =>
      renderToStaticMarkup(<FixScreen data={fixView(d, check, f.id, { asFirstSeen, plan })} />);
    const lines = everyPacketString(f.packet);
    // The command, what it prints today and what it prints after the fix, for each of three bodies.
    const sees = [f.packet, ...f.packet.packets].flatMap((b) => Object.values(b.verify.see!));
    expect(sees).toHaveLength(9);
    for (const s of sees) expect(lines, s).toContain(s);
    const locked = page('free');
    expect(locked).toContain('See this fix with Pro');
    for (const s of lines) expect(holds(locked, s), s).toBe(false);
    expect(locked).not.toMatch(/See it|Exact check|data-v2-packet-layers/);
    // The control: on Pro the page opens on the packet's own body, with its readable command.
    const open = page('pro');
    for (const s of Object.values(f.packet.verify.see!)) expect(holds(open, s), s).toBe(true);
  });

  it('asks for the keep bar instead, and offers no copy or email', () => {
    expect(markup).toContain('See this fix with Pro');
    expect(markup).not.toContain('Copy as a prompt');
    expect(markup).not.toContain('Email this fix');
    expect(markup).toMatch(/data-v2-primary=""[^>]*>Keep it</);
  });
});

describe('the packet block’s two verify layers', () => {
  const d = structuredClone(fixture('bad-site'));
  const f = d.fixes.find((x) => x.id === fixIdOf('bad-site'))!;
  /** A strict command of the length the engine writes: one line, thousands of characters, no space. */
  const long = `curl -sS --compressed 'https://example-outfitter.com/products/ridge-2p' | awk '${'x'.repeat(4000)}'`;
  f.packet = withSee({ ...f.packet!, verify: { ...f.packet!.verify, command: long } });
  const { check, asFirstSeen } = FIX_SOURCES['bad-site'];
  const markup = renderToStaticMarkup(
    <FixScreen data={fixView(d, check, f.id, { asFirstSeen })} />,
  );
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, '')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');

  it('shows “See it” with what it prints today and after the fix, then “Exact check”', () => {
    const see = seeFor('nextjs');
    const page = text(markup);
    const at = [
      'See it',
      see.command,
      `Today: ${see.today}`,
      `After the fix: ${see.after}`,
      'Exact check',
      long,
      `→ expect ${f.packet!.verify.expect}`,
      'We run the exact check on all 158 pages when you mark the fix done.',
    ].map((s) => page.indexOf(s));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('holds the whole strict command in the HTML, alone on the line of a strip that scrolls', () => {
    const strip = markup.match(
      /<div[^>]*data-v2-scroll-region=""[^>]*><pre[^>]*>([^<]*)<\/pre><\/div>/,
    );
    expect(strip).not.toBeNull();
    expect(text(strip![1]!)).toBe(`    ${long}`);
    // Once in the page: the block is not also printed whole beside its parts.
    expect(text(markup).split(long)).toHaveLength(2);
    // The readable command is not in the strip: it stays in the text above, which wraps.
    expect(text(strip![1]!)).not.toContain(seeFor('nextjs').command);
  });

  it('a packet without a readable command is one block, as the locked screen has it', () => {
    const plain = html('bad-site');
    expect(plain).not.toContain('data-v2-packet-layers');
    expect(plain.match(/<pre\b/g)).toHaveLength(1);
    expect(text(plain)).not.toMatch(/See it|Exact check|After the fix:/);
  });
});

describe('the fix page agrees with the Result and the segment', () => {
  it('shows each open fix’s effect as the fix records it, as the segment and the Result do', () => {
    const result = RESULT_PREVIEWS['bad-site']() as ResultView;
    for (const v of ['bad-site', 'first', 'third'] as const) {
      const f = fixOf(v);
      const page = fixPreview(v);
      const raw = f.effect.ai_readability || f.effect.technical_seo;
      expect(page.head.points).toBe(`+${raw}`);
      const row = result.fixes!.rows.find((r) => r.key === f.id)!;
      expect(row.points).toBe(`+${raw} ${f.effect.ai_readability ? 'AI' : 'SEO'}`);
      expect(row.href).toBe(FIX_SOURCES[v].path);
      const segment = (['access', 'nojs', 'structure', 'content'] as const)
        .flatMap((k) => SEGMENT_PREVIEWS[k]('bad-site').fixes.open)
        .find((o) => o.id === f.id)!;
      expect([segment.points, segment.unit]).toEqual([page.head.points, page.head.unit]);
    }
  });

  it('opens from the Result’s first fix', () => {
    const result = RESULT_PREVIEWS['bad-site']() as ResultView;
    expect(result.first.kind === 'fix' && result.first.href).toBe(FIX_SOURCES.first.path);
  });

  it('counts the audit’s live fixes in its crumb as the Result counts them', () => {
    const result = RESULT_PREVIEWS['bad-site']() as ResultView;
    expect(fixPreview('bad-site').frame.position).toBe(`Fix 2 of ${result.fixes!.total}`);
    const d = fixture('bad-site');
    expect(findCheck(d, FIX_SOURCES['bad-site'].check).id).toBe(FIX_SOURCES.locked.check);
  });
});
