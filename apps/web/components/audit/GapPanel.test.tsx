import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectedGrade } from '@crawlmouse/types';
import { GapPanel } from './GapPanel';
import { freeFixture } from './__fixtures__/client-audit-v2';

const pg = freeFixture.projectedGrade as ProjectedGrade;
const html = renderToStaticMarkup(<GapPanel projected={pg} />);

describe('GapPanel', () => {
  it('shows the current → achievable grades and the score gain', () => {
    expect(html).toContain('B+'); // projected grade
    expect(html).toContain('>64<'); // current score
    expect(html).toContain('>86<'); // projected score
    expect(html).toContain(`(+${pg.projected.score - pg.current.score})`); // +22, relative
  });

  it('renders the disclaimer verbatim (U3)', () => {
    expect(html).toContain(pg.disclaimer);
  });
});
