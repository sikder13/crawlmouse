import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectedGrade } from '@crawlmouse/types';
import { LockedCureCard } from './LockedCureCard';
import { freeFixture } from './__fixtures__/client-audit-v2';

const ledger = (freeFixture.projectedGrade as ProjectedGrade).ledger;

describe('LockedCureCard', () => {
  it('shows the diagnosis + a calm locked affordance, never cure content', () => {
    const locked = ledger[1];
    if (!locked) throw new Error('fixture missing ledger item');
    const html = renderToStaticMarkup(<LockedCureCard diagnosis={locked} />);
    expect(html).toContain(locked.targetTitle as string); // 'The Internal Linking Guide'
    expect(html).toContain('Pro'); // lock affordance
    expect(html).toContain('+'); // relative impact label
    // The component only receives a FixDiagnosis — no cure/anchor/packet content can be present.
    expect(html).not.toContain('Copy for');
    expect(html).not.toContain('anchor');
  });
});
