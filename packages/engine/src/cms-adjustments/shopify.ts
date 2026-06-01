import { pathExcluder, type CmsAdjustments } from './base.js';

const SHOPIFY_EXCLUDED_PATHS = [
  /^\/cart/,
  /^\/checkout/,
  /^\/account/,
  /^\/policies/,
  /^\/search/,
  /^\/products\.json/,
  /^\/collections\.json/,
];

export const shopifyAdjustments: CmsAdjustments = pathExcluder(SHOPIFY_EXCLUDED_PATHS);
