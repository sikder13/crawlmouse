/**
 * F-274, review #7 and #8: a fix with no effect to name leaves no empty effect block and no dangling
 * separator, on the fix page's head, the segment's open fix and Pro rows, and the fix page's
 * "Next fix" button.
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FixScreen } from '../../../components/v2/screens/fix/FixScreen';
import { ContentScreen } from '../../../components/v2/screens/segment/ContentScreen';
import { findCheck, fixesAsOf, fixture } from '../fixtures';
import { fixView } from './fix';
import { contentView } from './segment/content';
import { FIRST_AUDIT } from './segment/test-helpers';

const CHECK = FIRST_AUDIT['bad-site'];

/** The bad site with every content fix's AI effect waiting on an unmeasured part. */
function unmeasured(): FixtureDataset {
  const d = structuredClone(fixture('bad-site'));
  for (const f of d.fixes) {
    if (f.section !== 'content') continue;
    f.effect.ai_readability = null;
    f.effect.ai_readability_pending_on = ['quotable_unmeasured'];
    f.effect.technical_seo = 0;
  }
  return d;
}

/** An element whose class names a points slot and that holds nothing. */
const EMPTY_POINTS = /<span class="[^"]*[pP]oints[^"]*"><\/span>/;

describe('a fix with no effect to name', () => {
  it('the fix page draws no empty effect block', () => {
    const d = unmeasured();
    const f = fixesAsOf(d, findCheck(d, CHECK)).find((x) => x.section === 'content')!;
    const view = fixView(d, CHECK, f.id, { plan: 'pro', asFirstSeen: true });
    expect(view.head).toMatchObject({ points: '', unit: '' });
    const markup = renderToStaticMarkup(<FixScreen data={view} />);
    expect(markup).not.toMatch(EMPTY_POINTS);
  });

  it('the segment draws no empty effect, and no row ends on a separator', () => {
    const d = unmeasured();
    const markup = renderToStaticMarkup(
      <ContentScreen data={contentView(d, CHECK, { plan: 'pro', asFirstSeen: true })} />,
    );
    expect(markup).not.toMatch(EMPTY_POINTS);
    expect(markup).not.toMatch(/· <\/span>|·\s*<\/span>/);
  });

  it('the fix before it names the next fix with no trailing separator (review #8)', () => {
    const d = unmeasured();
    const live = fixesAsOf(d, findCheck(d, CHECK));
    const at = live.findIndex((x, i) => i > 0 && x.section === 'content');
    const before = live[at - 1]!;
    const following = live[at]!;
    const next = fixView(d, CHECK, before.id, { plan: 'pro', asFirstSeen: true }).frame.next;
    expect(next?.label).toBe(`Next fix: ${following.title}`);
  });
});
