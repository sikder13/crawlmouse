import type { CmsName } from '@crawlmouse/types';

export interface Signature {
  cms: CmsName;
  htmlPatterns?: RegExp[];
  headerPatterns?: { name: string; pattern: RegExp | 'present' }[];
}

export const SIGNATURES: Signature[] = [
  {
    cms: 'shopify',
    htmlPatterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /shopify-section/i],
    headerPatterns: [
      { name: 'x-shopid', pattern: 'present' },
      { name: 'x-shopify-stage', pattern: 'present' },
    ],
  },
  {
    cms: 'wordpress',
    htmlPatterns: [/wp-content/i, /<meta\s+name=["']generator["']\s+content=["']WordPress/i, /wp-json/i],
  },
  {
    cms: 'webflow',
    htmlPatterns: [/data-wf-page/i, /webflow\.com/i, /wf-form/i],
    headerPatterns: [{ name: 'x-powered-by', pattern: /webflow/i }],
  },
  {
    cms: 'wix',
    htmlPatterns: [/static\.wixstatic\.com/i, /window\.wixBiSession/i],
    headerPatterns: [{ name: 'x-wix-published-version', pattern: 'present' }],
  },
  {
    cms: 'squarespace',
    htmlPatterns: [/static1\.squarespace\.com/i, /Static\.SQUARESPACE_CONTEXT/i],
  },
  {
    cms: 'framer',
    htmlPatterns: [/framer\.com/i, /__framer__/i],
    headerPatterns: [{ name: 'x-framer-site-id', pattern: 'present' }],
  },
  {
    cms: 'ghost',
    htmlPatterns: [/<meta\s+name=["']generator["']\s+content=["']Ghost/i],
  },
];
