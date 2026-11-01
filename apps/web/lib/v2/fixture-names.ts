/** The three CC-11 contract fixtures, by file name. Kept apart so client code can name them. */
export const FIXTURE_NAMES = ['bad-site', 'clean-site', 'challenged-site'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];
