import { describe, expect, it } from 'vitest';
import { generatedGraph } from './generated-graph';

describe('generatedGraph', () => {
  it('builds the same graph from the same seed, and another from another seed', () => {
    expect(generatedGraph(300, 2026)).toEqual(generatedGraph(300, 2026));
    expect(generatedGraph(300, 2026)).not.toEqual(generatedGraph(300, 12345));
  });

  it('puts an orphan at every 13th page and a JavaScript link at every 7th otherwise', () => {
    const g = generatedGraph(2_000, 2026);
    expect(g).toHaveLength(2_000);
    // 1..1,999: 153 multiples of 13; of the multiples of 7, those of 91 are orphans already.
    expect(g.filter((n) => n.kind === 'orphan')).toHaveLength(153);
    expect(g.filter((n) => n.kind === 'js_only')).toHaveLength(285 - 21);
    expect(g.every((n) => n.depth === null || n.depth <= 6)).toBe(true);
  });
});
