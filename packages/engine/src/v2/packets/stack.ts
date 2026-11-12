/**
 * The framework a packet is written for first, from the check's stack: the detected front end's, or
 * the framework that is the CMS itself. A WordPress or Webflow site is edited in that product, so its
 * CMS names the stack the change is made on; a Shopify store is not listed, because the CMS name
 * does not say whether its front end is a Liquid theme or Hydrogen. Null when neither names one.
 */
import type { PacketFacts, PacketFramework } from './types.js';

type Cms = NonNullable<PacketFacts['stack']['backend']>['cms'];

export const FRAMEWORK_OF_CMS: Readonly<Partial<Record<Cms, PacketFramework>>> = {
  wordpress: 'wordpress',
  webflow: 'webflow',
};

export function frameworkOf(stack: PacketFacts['stack']): PacketFramework | null {
  if (stack.frontend) return stack.frontend.framework;
  return (stack.backend && FRAMEWORK_OF_CMS[stack.backend.cms]) ?? null;
}
