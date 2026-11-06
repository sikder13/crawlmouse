/**
 * The fixtures, by file name: the three CC-11 contract fixtures, and `built-site`, which the check
 * builder (CC-20a) produced. Kept apart so client code can name them.
 */
export const FIXTURE_NAMES = ['bad-site', 'clean-site', 'challenged-site', 'built-site'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];
