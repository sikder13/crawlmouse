import type { Verdict } from '@crawlmouse/types/v2';
import { BODY_EXCERPT_BYTES } from '../rows/evidence.js';
import { THIN_RATIO } from './table.js';

const thin = `${THIN_RATIO * 100}%`;

/** What each verdict means and what evidence its row carries. Rendered into the spec and the runbook. */
export const VERDICT_MEANINGS: Record<Verdict, { means: string; evidence: string }> = {
  allowed: {
    means: `The crawler's tagged request was served, with at least ${thin} of the browser control's words.`,
    evidence: `The crawler's request and response: status, verdict headers, first ${BODY_EXCERPT_BYTES} bytes, word count.`,
  },
  allowed_thin: {
    means: `Served, but with under ${thin} of the browser control's words.`,
    evidence: "The crawler's response; a limitation gives both word counts.",
  },
  disallowed_by_robots: {
    means: 'robots.txt tells the crawler not to fetch the path, so nothing was requested as it.',
    evidence: 'The robots.txt request (evidence class declared).',
  },
  blocked_by_ua_rule: {
    means:
      'The crawler was refused while the tagged Googlebot canary was served on the same page: the site demonstrably does not verify crawler IPs there, so the refusal is aimed at the user agent.',
    evidence: "The crawler's response; the canary's own row on the same page.",
  },
  challenged_ua: {
    means:
      'The crawler was given a challenge while the browser control was served. The real crawler, from its own IPs, may pass.',
    evidence:
      "The crawler's response, with the mitigation header or challenge redirect that identified it.",
  },
  refused_unverified: {
    means:
      'The crawler was refused and the canary was not served, so a rule against the user agent cannot be told apart from IP verification. The real crawler may pass.',
    evidence:
      "The crawler's response; a limitation says what the canary got and which crawlers were served on the page.",
  },
  rate_limited: {
    means: 'The crawler was answered with 429.',
    evidence: "The crawler's response, with Retry-After when sent.",
  },
  payment_required: {
    means: 'The crawler was answered with 402: the site charges crawlers.',
    evidence: "The crawler's response, with crawler-price when sent.",
  },
  edge_blocks_automation: {
    means:
      'The untagged browser control was itself challenged or refused, so the site treats our requests this way whatever the user agent. The crawlers were not requested.',
    evidence: "The control's request and response.",
  },
  redirected_away: {
    means: 'The crawler was redirected to another site; the target was not requested.',
    evidence: 'The redirect response, its Location, and the final URL it pointed to.',
  },
  not_measured: {
    means:
      'No verdict could be measured: robots.txt unreachable or asking Crawlmouse not to fetch, the control not served, a budget spent, the site stopped, or the request failed.',
    evidence: 'Whatever request was made, if any; the limitation says which reason applied.',
  },
};
