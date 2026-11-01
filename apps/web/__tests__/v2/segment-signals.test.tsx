import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SEGMENT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/segments';
import { RESULT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import type { ResultView } from '../../lib/v2/view/result';
import { applyChanges, COPY_CHANGES } from '../../lib/v2/copy-registry';
import {
  expected,
  firstDifference,
  locked,
  lockedText,
  renderedText,
  squash,
  withoutShell,
} from './_lib/lock';
import { SEGMENT_VARIANTS, segmentElement } from './_lib/screens';

const RESULT_OF = { 'bad-site': 'bad-site', clean: 'clean', challenged: 'challenged' } as const;
const door = (variant: (typeof SEGMENT_VARIANTS)[number]) =>
  (RESULT_PREVIEWS[RESULT_OF[variant]]() as ResultView).doors[4]!;

describe('Final-Seg-Signals, the bad site', () => {
  const html = renderToStaticMarkup(segmentElement('signals', 'bad-site'));

  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Seg-Signals.dc.html')).rest, 'segment-signals'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });
});

describe.each(SEGMENT_VARIANTS)('Signals, %s', (variant) => {
  const html = renderToStaticMarkup(segmentElement('signals', variant));
  const data = SEGMENT_PREVIEWS.signals(variant);
  const d = door(variant);

  it('has one orange element: "Next: Changes" (FACTS orange convention: no free fix here)', () => {
    const primaries = html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatch(/>Next: Changes$/);
  });

  it('counts what is present as the door does, and as the table rows show it', () => {
    const present = data.rows.filter((r) => r.status.label === 'present').length;
    expect(data.headline.pill.label).toBe(`${present} of ${data.rows.length}`);
    expect(d.pill.label).toBe(`${present} of ${data.rows.length} present`);
    expect(data.tiles[0]!.value).toBe(String(present));
    expect(data.tiles[1]!.value).toBe(
      String(data.rows.filter((r) => r.status.label === 'absent').length),
    );
  });

  it('says what it read, in the door’s words', () => {
    expect('read' in d.coverage ? d.coverage.read : null).toBe(data.coverage.read);
  });

  it('shows each signal’s class, and says so where a signal carries no weight', () => {
    expect(html.match(/data-v2-recommendation="/g) ?? []).toHaveLength(data.rows.length);
    const none = data.rows.filter((r) => r.weight === 'Carries no weight in the grade.').length;
    expect(html.split('Carries no weight in the grade.').length - 1).toBe(none);
  });
});

describe('a lock entry for a column the locked page hides on a phone', () => {
  it('is left out of the phone reading only, and still fails where it is not left out', () => {
    const hidden = COPY_CHANGES.filter((c) => c.screen === 'segment-signals' && c.hiddenOnPhone);
    expect(hidden.length).toBeGreaterThan(0);
    // The phone reading: the locked text without what the hidden column held.
    let phoneText = lockedText(locked('Final-Seg-Signals.dc.html'));
    for (const c of hidden) phoneText = phoneText.replace(squash(c.locked), '');
    expect(() => applyChanges(phoneText, 'segment-signals', squash, { phone: true })).not.toThrow();
    expect(() => applyChanges(phoneText, 'segment-signals', squash)).toThrow(/no longer matches/);
  });
});
