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

/** "1,120": thousands grouped, as the screens print counts. */
export const count = (n: number) => n.toLocaleString('en-US');

/**
 * A count in words, as the locked copy spells small numbers ("seven orphan pages"). Above twenty
 * it is written in digits; a negative or fractional count is a programming error.
 */
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`No word for ${n}`);
  return WORDS[n] ?? count(n);
}

/** Upper-cases the first character in place; nothing is cut (its inputs are number words). */
export const capitalise = (s: string) => s.replace(/^./u, (c) => c.toUpperCase());

/** "page" or "pages". */
export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
