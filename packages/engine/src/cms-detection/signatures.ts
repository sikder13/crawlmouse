import type { CmsName } from '@crawlmouse/types';

export interface Signature {
  cms: CmsName;
  htmlPatterns?: RegExp[];
  headerPatterns?: { name: string; pattern: RegExp | 'present' }[];
}

// Signals are intentionally HIGH-precision: platform asset-CDN hostnames, infra
// response headers, generator meta tags, and injected namespaced attributes.
// We deliberately do NOT key off bare brand-domain mentions (e.g. "webflow.com",
// "framer.com") — those appear on any site that merely links to, credits, or
// writes about the platform, and are not present in the maintained Wappalyzer
// ruleset for this reason. Note several strong asset hosts (website-files.com,
// framerusercontent.com, parastorage.com) don't even contain the brand name.
// (Future: scope asset-host matches to actual src/href attributes for even fewer
// false positives.)
export const SIGNATURES: Signature[] = [
  {
    cms: 'shopify',
    htmlPatterns: [
      /cdn\.shopify\.com/i,
      /sdks\.shopifycdn\.com/i,
      /Shopify\.theme/i,
      /shopify-section/i,
      /shopify-checkout-api-token/i,
    ],
    headerPatterns: [
      { name: 'x-shopid', pattern: 'present' },
      { name: 'x-shopify-stage', pattern: 'present' },
      { name: 'x-sorting-hat-shopid', pattern: 'present' },
    ],
  },
  {
    cms: 'wordpress',
    htmlPatterns: [
      /\/wp-content\//i,
      /\/wp-includes\//i,
      /\/wp-json\//i,
      /<meta\s+name=["']generator["']\s+content=["']WordPress/i,
    ],
    headerPatterns: [{ name: 'x-pingback', pattern: /xmlrpc\.php/i }],
  },
  {
    cms: 'webflow',
    htmlPatterns: [
      /data-wf-(?:page|site)=/i,
      /<meta\s+name=["']generator["']\s+content=["']Webflow/i,
      /assets(?:-global)?\.website-files\.com/i,
      /cdn\.prod\.website-files\.com/i,
      /uploads-ssl\.webflow\.com/i,
    ],
    headerPatterns: [{ name: 'server', pattern: /^Webflow$/i }],
  },
  {
    cms: 'wix',
    htmlPatterns: [/static\.wixstatic\.com/i, /static\.parastorage\.com/i, /window\.wixBiSession/i],
    headerPatterns: [
      { name: 'x-wix-request-id', pattern: 'present' },
      { name: 'x-wix-renderer-server', pattern: 'present' },
    ],
  },
  {
    cms: 'squarespace',
    htmlPatterns: [
      /static1\.squarespace\.com/i,
      /images\.squarespace-cdn\.com/i,
      /Static\.SQUARESPACE_CONTEXT/i,
    ],
    headerPatterns: [{ name: 'server', pattern: /Squarespace/i }],
  },
  {
    cms: 'framer',
    htmlPatterns: [
      /framerusercontent\.com/i,
      /data-framer-hydrate-v2/i,
      /__framer__/i,
      /<meta\s+name=["']generator["']\s+content=["']Framer/i,
    ],
    headerPatterns: [{ name: 'x-framer-site-id', pattern: 'present' }],
  },
  {
    cms: 'ghost',
    htmlPatterns: [/<meta\s+name=["']generator["']\s+content=["']Ghost/i],
    headerPatterns: [{ name: 'x-ghost-cache-status', pattern: 'present' }],
  },
];
