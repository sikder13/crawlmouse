import type { CmsAdjustments } from './index.js';

const SHOPIFY_EXCLUDED_PATHS = [
  /^\/cart/,
  /^\/checkout/,
  /^\/account/,
  /^\/policies/,
  /^\/search/,
  /^\/products\.json/,
  /^\/collections\.json/,
];

export const shopifyAdjustments: CmsAdjustments = {
  excludeFromOrphans(url: string) {
    try {
      const u = new URL(url);
      return SHOPIFY_EXCLUDED_PATHS.some((p) => p.test(u.pathname));
    } catch {
      return false;
    }
  },
};
