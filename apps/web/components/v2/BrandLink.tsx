import { CrawlmouseMark } from '../icons/CrawlmouseMark';
import styles from './PageShell.module.css';

/** The brand: the CrawlmouseMark and the crawl + orange mouse wordmark, linking home. */
export function BrandLink() {
  return (
    <a href="/" className={styles.brand} aria-label="Crawlmouse home">
      <CrawlmouseMark size={24} className={styles.mark} />
      <span className={styles.wordmark} data-v2-wordmark="">
        crawl<span className={styles.wordmarkMouse}>mouse</span>
      </span>
    </a>
  );
}
