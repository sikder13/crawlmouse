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

  it('rounds 2-decimal engine scores at the render boundary — no float garbage (regression-lock)', () => {
    const floatPg: ProjectedGrade = {
      ...pg,
      current: { score: 63.66, grade: 'C' },
      projected: { score: 85.5, grade: 'B+' },
    };
    const out = renderToStaticMarkup(<GapPanel projected={floatPg} />);
    expect(out).toContain('>64<'); // Math.round(63.66)
    expect(out).toContain('>86<'); // Math.round(85.5)
    expect(out).toContain('(+22)'); // 86 − 64, internally consistent (not the raw 21.84)
    expect(out).not.toContain('63.66');
    expect(out).not.toContain('85.5');
    expect(out).not.toContain('21.84');
  });

  it('renders the disclaimer verbatim (U3)', () => {
    expect(html).toContain(pg.disclaimer);
  });

  it('frames the gap as a GRADE claim, not a traffic promise, with an honest recrawl timeline', () => {
    expect(html).toContain('not a traffic forecast');
    expect(html.toLowerCase()).toContain('recrawl');
    expect(/re-?rank/i.test(html)).toBe(true);
  });
});
