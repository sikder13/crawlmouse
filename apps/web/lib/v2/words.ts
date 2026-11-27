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

const ORDINALS = [
  '',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
];

/** "first" … "twelfth", then "13th", "21st", "22nd", "23rd": a row's place, as a button names it. */
export function ordinalWord(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`No ordinal for ${n}`);
  if (n < ORDINALS.length) return ORDINALS[n]!;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen
    ? 'th'
    : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${suffix}`;
}
