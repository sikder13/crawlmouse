/**
 * Sitemap URLs discovery reads as seeds at most (ARCH-2 §4.2 step 1). Its own module so the crawl
 * screen, which runs in the browser, can name it without importing the pipeline's limits.
 */
export const SITEMAP_URL_CAP = 5000;
