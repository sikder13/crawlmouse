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
import { findCheck, fixture } from '../../lib/v2/fixtures';
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

  it('asks for the keep bar instead, and offers no copy or email', () => {
    expect(markup).toContain('See this fix with Pro');
    expect(markup).not.toContain('Copy as a prompt');
    expect(markup).not.toContain('Email this fix');
    expect(markup).toMatch(/data-v2-primary=""[^>]*>Keep it</);
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
