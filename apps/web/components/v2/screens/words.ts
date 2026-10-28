const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/** A count in words, as the locked copy spells small numbers ("seven orphan pages"). */
export function numberWord(n: number): string {
  const w = WORDS[n];
  if (w === undefined || !Number.isInteger(n)) throw new Error(`No word for ${n}`);
  return w;
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "1,120": thousands grouped, as the screens print counts. */
export const count = (n: number) => n.toLocaleString('en-US');

/** "page" or "pages". */
export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
