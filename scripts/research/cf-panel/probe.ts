import { DOMAIN_DEADLINE_MS, fetchHeaders, fetchText, withDeadline, withRetry, errorMessage } from './fetcher.js';
import type { PanelGroup } from './types.js';

/** Cap for the ads.txt body read during panel build. Only presence + shape matter, never content. */
const ADS_TXT_MAX_BYTES = 512 * 1024;

export interface DomainProbe {
  domain: string;
  homepageStatus: number;
  server: string | null;
  cfRay: boolean;
  adsTxtStatus: number;
  adsTxtValid: boolean;
  /** Set when the /ads.txt probe itself failed, which is NOT the same as "this site has no ads.txt". */
  adsTxtError: string | null;
  error: string | null;
}

/** Cloudflare-proxied, from the two public signals the study declares: `cf-ray`, or `server: cloudflare`. */
export function isCloudflare(server: string | null, cfRay: boolean): boolean {
  if (cfRay) return true;
  return (server ?? '').trim().toLowerCase() === 'cloudflare';
}

/**
 * Is this body a real ads.txt rather than a soft 404?
 *
 * A great many sites answer /ads.txt with 200 and an HTML error page, which would put non-advertising
 * sites in the ad-supported stratum and quietly corrupt the panel. Two independent checks: the body
 * must not open as markup, and it must carry at least one line shaped like an IAB ads.txt record —
 * `<ad system domain>, <publisher id>, <relationship>` — so two or more commas with a domain first.
 */
export function isPlausibleAdsTxt(body: string): boolean {
  const trimmed = body.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('<')) return false;
  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw.split('#')[0]!.trim();
    if (!line) continue;
    const fields = line.split(',').map((f) => f.trim());
    if (fields.length < 3) continue;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(fields[0]!)) continue;
    if (!fields[1]) continue;
    return true;
  }
  return false;
}

/**
 * Has a panel entry's evidence changed since the build?
 *
 * Compares LIKE WITH LIKE. The panel recorded whether /ads.txt was a valid ads.txt, using its body;
 * a snapshot only re-checks the status, because the body is deliberately never stored again. So the
 * comparison is status-to-status against the panel's own recorded status — comparing the snapshot's
 * loose "200?" against the build's strict "200 and parses?" would flag every site that answers
 * /ads.txt with an HTML error page, on every run, forever.
 */
export function evidenceChanged(
  evidence: { server: string | null; cfRay: boolean; adsTxtStatus: number },
  now: { server: string | null; cfRay: boolean; adsTxtStatus: number | null },
): boolean {
  const wasCf = isCloudflare(evidence.server, evidence.cfRay);
  const isCf = isCloudflare(now.server, now.cfRay);
  return wasCf !== isCf || (evidence.adsTxtStatus === 200) !== (now.adsTxtStatus === 200);
}

/** Which stratum these signals put a domain in, or null when it belongs to none. */
export function groupFor(cloudflare: boolean, ads: boolean): PanelGroup | null {
  if (cloudflare && ads) return 'cf_ads';
  if (cloudflare && !ads) return 'cf_no_ads';
  if (!cloudflare && ads) return 'ads_no_cf';
  return null;
}

/**
 * Two lightweight requests: homepage headers (never content) and /ads.txt. The ads.txt body is read
 * here — and only here — because the group assignment depends on its shape; snapshots re-check the
 * status alone and never store it.
 */
export function probeDomain(domain: string): Promise<DomainProbe> {
  return withDeadline(() => probeDomainInner(domain), DOMAIN_DEADLINE_MS, `probe ${domain}`).catch((e: unknown) => ({
    domain,
    homepageStatus: 0,
    server: null,
    cfRay: false,
    adsTxtStatus: 0,
    adsTxtValid: false,
    adsTxtError: null,
    error: errorMessage(e),
  }));
}

async function probeDomainInner(domain: string): Promise<DomainProbe> {
  const base: DomainProbe = {
    domain,
    homepageStatus: 0,
    server: null,
    cfRay: false,
    adsTxtStatus: 0,
    adsTxtValid: false,
    adsTxtError: null,
    error: null,
  };

  try {
    const head = await withRetry(() => fetchHeaders(`https://${domain}/`));
    base.homepageStatus = head.status;
    base.server = head.server;
    base.cfRay = head.cfRay;
  } catch (e) {
    base.error = errorMessage(e);
    return base;
  }

  try {
    const ads = await withRetry(() => fetchText(`https://${domain}/ads.txt`, ADS_TXT_MAX_BYTES));
    base.adsTxtStatus = ads.status;
    base.adsTxtValid = ads.status === 200 && isPlausibleAdsTxt(ads.body);
  } catch (e) {
    // A DNS/TLS/timeout failure on /ads.txt is NOT the "no ads" signal — it is no signal at all, and
    // treating it as one puts a site in cf_no_ads because a request timed out. The candidate is
    // marked unclassifiable and build-panel skips it; candidates are cheap, a mis-stratified panel
    // entry is not. A 404 is different: that is a real answer, and it means no ads.txt.
    base.adsTxtStatus = 0;
    base.adsTxtValid = false;
    base.adsTxtError = errorMessage(e);
  }

  return base;
}
