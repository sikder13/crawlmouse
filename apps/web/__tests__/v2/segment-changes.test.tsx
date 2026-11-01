import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HISTORY_SOURCES,
  SEGMENT_PREVIEWS,
  changesHistoryPreview,
} from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { RESULT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import { fixture } from '../../lib/v2/fixtures';
import type { ResultView } from '../../lib/v2/view/result';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';
import { SEGMENT_VARIANTS, changesHistoryElement, segmentElement } from './_lib/screens';

const RESULT_OF = { 'bad-site': 'bad-site', clean: 'clean', challenged: 'challenged' } as const;
const door = (variant: (typeof SEGMENT_VARIANTS)[number]) =>
  (RESULT_PREVIEWS[RESULT_OF[variant]]() as ResultView).doors[5]!;
const primaries = (html: string) => html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];

describe('Final-Seg-Changes, the bad site', () => {
  const html = renderToStaticMarkup(segmentElement('changes', 'bad-site'));

  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Seg-Changes.dc.html')).rest, 'segment-changes'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });
});

describe.each(SEGMENT_VARIANTS)('Changes, %s: a first audit', (variant) => {
  const html = renderToStaticMarkup(segmentElement('changes', variant));
  const data = SEGMENT_PREVIEWS.changes(variant);

  it('agrees with the door: a first audit, one audit in the history, no changes', () => {
    expect(door(variant).pill.label).toBe('first audit');
    expect(data.history).toHaveLength(1);
    expect(data.headline.pill.label).toBe('1 audit');
    expect(data.tiles[0]!.value).toBe('1');
    expect(data.rows).toEqual([]);
  });

  it('makes the keep bar’s button its one orange element while nobody keeps the audit, and has none once kept', () => {
    const found = primaries(html);
    if (data.keep) {
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/>Keep it$/);
    } else {
      expect(found).toEqual([]);
    }
  });
});

describe.each(['history', 'challenged-history'] as const)('Changes, %s: a re-check', (name) => {
  const html = renderToStaticMarkup(changesHistoryElement(name));
  const data = changesHistoryPreview(name);
  const src = HISTORY_SOURCES[name];
  const found = fixture(src.fixture).changes.filter((c) => c.check_id === src.check);

  it('lists each change the check found, and counts them in its headline and tile', () => {
    expect(found.length).toBeGreaterThan(0);
    expect(data.rows.map((r) => r.key)).toEqual(found.map((c) => c.id));
    expect(data.headline.pill.label).toBe(
      `${found.length} ${found.length === 1 ? 'change' : 'changes'}`,
    );
    expect(data.tiles[1]).toEqual({
      label: 'Changes at this check',
      value: String(found.length),
      note: null,
    });
    expect(html.match(/<tr/g)!.length).toBeGreaterThan(found.length);
  });

  it('says "first observed", never "caused by", and has no orange element on a kept site', () => {
    expect(renderedText(html)).not.toMatch(/causedby/i);
    expect(data.rows.every((r) => r.cause.startsWith('First observed'))).toBe(true);
    expect(primaries(html)).toEqual([]);
  });
});
