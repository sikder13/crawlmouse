import type { CmsName } from '@crawlmouse/types';
import { shopifyAdjustments } from './shopify.js';
import { wordpressAdjustments } from './wordpress.js';
import { genericAdjustments } from './generic.js';

export { pathExcluder } from './base.js';
export type { CmsAdjustments } from './base.js';
import type { CmsAdjustments } from './base.js';

export function getAdjustments(cms: CmsName): CmsAdjustments {
  switch (cms) {
    case 'shopify': return shopifyAdjustments;
    case 'wordpress': return wordpressAdjustments;
    default: return genericAdjustments;
  }
}
