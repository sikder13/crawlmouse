/**
 * Trial ending against Final-TrialEnd: the visible text, rail included, equals the locked HTML with
 * the registered changes applied (lib/v2/copy/trial-end.ts) and nothing else; one orange element,
 * Keep; the rail's card carries no Keep and no promise of the reminder that has been sent.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrialEndScreen } from '../../components/v2/screens/trial-end/TrialEndScreen';
import { trialEndPreview } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const html = renderToStaticMarkup(<TrialEndScreen data={trialEndPreview()} />);
const primaries = (markup: string) => markup.match(/data-v2-primary=""/g) ?? [];

describe('Trial ending against Final-TrialEnd', () => {
  it('reads as the locked HTML outside the rail’s links, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-TrialEnd.dc.html')).rest, 'trial-end'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('has one orange element, Keep, and none in the rail', () => {
    expect(primaries(html)).toHaveLength(1);
    expect(html).toMatch(/data-v2-primary=""[^>]*>Keep Pro, \$19 a month · add a card</);
    const rail = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(primaries(rail)).toHaveLength(0);
    expect(rail).not.toContain('email you');
  });

  it('marks no rail entry as this page: it is none of them', () => {
    expect(html).not.toContain('aria-current');
  });
});
