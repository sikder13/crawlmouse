import type { CmsName } from '@crawlmouse/types';
import { shopifyAdjustments } from './shopify.js';
import { wordpressAdjustments } from './wordpress.js';
import { genericAdjustments } from './generic.js';

export interface CmsAdjustments {
  excludeFromOrphans: (url: string) => boolean;
}

export function getAdjustments(cms: CmsName): CmsAdjustments {
  switch (cms) {
    case 'shopify': return shopifyAdjustments;
    case 'wordpress': return wordpressAdjustments;
    default: return genericAdjustments;
  }
}
