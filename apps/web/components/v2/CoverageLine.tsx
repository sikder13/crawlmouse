import styles from './CoverageLine.module.css';

export interface Coverage {
  /** Pages fetched as the crawlers. */
  tested: number;
  /** Pages the site has, as far as the crawl found. */
  total: number;
  /** Template groups the tested pages were drawn from. */
  groups: number;
}

const count = (n: number) => n.toLocaleString('en-US');
const isCount = (n: number) => Number.isInteger(n) && n >= 0;

/**
 * The sentence, built from the numbers so it cannot claim more than they say. Throws on numbers
 * that cannot be true together: more pages tested than exist, or more groups than tested pages.
 */
export function coverageText({ tested, total, groups }: Coverage): string {
  if (![tested, total, groups].every(isCount)) {
    throw new Error(`Coverage counts must be whole numbers ≥ 0: ${tested}, ${total}, ${groups}`);
  }
  if (tested > total) throw new Error(`Tested ${tested} pages of only ${total}`);
  if (tested === 0 ? groups !== 0 : groups < 1 || groups > tested) {
    throw new Error(`${tested} tested pages cannot span ${groups} groups`);
  }
  return `Tested ${count(tested)} of ${count(total)} ${total === 1 ? 'page' : 'pages'} across ${count(groups)} ${groups === 1 ? 'group' : 'groups'}`;
}

/** "Tested N of M pages across K groups." */
export function CoverageLine(props: Coverage) {
  return (
    <p className={styles.line} data-v2-coverage="">
      {coverageText(props)}
    </p>
  );
}
