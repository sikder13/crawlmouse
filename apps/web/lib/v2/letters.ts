/**
 * The engine's letter scale (`scoreToLetter` in packages/engine/src/grade.ts), copied rather than
 * imported to keep the engine out of the UI; letters.test.ts pins the copy to the engine at every
 * score from 0 to 100. Bands group the letters the way a reader does: A-, A are both "an A".
 */
const FLOORS: readonly [number, string][] = [
  [90, 'A'],
  [85, 'A-'],
  [80, 'B+'],
  [75, 'B'],
  [70, 'B-'],
  [65, 'C+'],
  [60, 'C'],
  [55, 'C-'],
  [50, 'D+'],
  [45, 'D'],
  [40, 'D-'],
  [0, 'F'],
];

export function letterFor(score: number): string {
  return FLOORS.find(([floor]) => score >= floor)![1];
}

/** "A", "B", "C", "D" or "F". */
export const bandOf = (letter: string) => letter.charAt(0);

/** The lowest score in the band above `letter`'s, or null at the top band. */
export function nextBandFloor(letter: string): { score: number; letter: string } | null {
  const band = bandOf(letter);
  const above = FLOORS.filter(([, l]) => bandOf(l) < band);
  const lowest = above.at(-1);
  return lowest ? { score: lowest[0], letter: lowest[1] } : null;
}

/** D and F read as bad news; the screens draw those grades in the bad tone. */
export const toneOf = (letter: string): 'default' | 'bad' =>
  bandOf(letter) === 'D' || bandOf(letter) === 'F' ? 'bad' : 'default';
