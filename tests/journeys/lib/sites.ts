import { canonicalHost } from './target';

/**
 * The sites a journey may start a check of: our own lab hosts and the owner's nahltech.com (CC-45 brief
 * §4; RULES §4 "Customers' sites"). A step that starts a check passes its address through here first.
 */
export function assertCheckableSite(address: string): string {
  const host = canonicalHost(
    new URL(address.includes('://') ? address : `https://${address}`).hostname,
  );
  if (host === 'nahltech.com' || host.endsWith('.lab.crawlmouse.com')) return address;
  throw new Error(`${host} is not a lab site or nahltech.com: journeys check no other site`);
}
