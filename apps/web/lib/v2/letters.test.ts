import { describe, expect, it } from 'vitest';
import { scoreToLetter } from '../../../../packages/engine/src/grade';
import { bandOf, letterFor, nextBandFloor, toneOf } from './letters';

describe('the letter scale', () => {
  it('matches the engine at every whole score', () => {
    for (let s = 0; s <= 100; s++) expect(letterFor(s), String(s)).toBe(scoreToLetter(s));
  });

  it('finds the floor of the band above', () => {
    expect(nextBandFloor('B')).toEqual({ score: 85, letter: 'A-' });
    expect(nextBandFloor('B-')).toEqual({ score: 85, letter: 'A-' });
    expect(nextBandFloor('C+')).toEqual({ score: 70, letter: 'B-' });
    expect(nextBandFloor('F')).toEqual({ score: 40, letter: 'D-' });
    expect(nextBandFloor('A-')).toBeNull();
  });

  it('draws D and F in the bad tone, and nothing else', () => {
    expect(['A', 'B+', 'C-', 'D+', 'D', 'F'].map(toneOf)).toEqual([
      'default',
      'default',
      'default',
      'bad',
      'bad',
      'bad',
    ]);
    expect(bandOf('A-')).toBe('A');
  });
});
