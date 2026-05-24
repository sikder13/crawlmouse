import type { CmsName } from '@crawlmouse/types';
import { SIGNATURES } from './signatures.js';

export interface DetectionResult {
  cms: CmsName;
  confidence: number;       // 0..1
}

export function detectCms(html: string, headers: Record<string, string | undefined>): DetectionResult {
  let bestCms: CmsName = 'custom';
  let bestScore = 0;

  for (const sig of SIGNATURES) {
    const htmlMatches = sig.htmlPatterns?.filter((p) => p.test(html)).length ?? 0;
    const headerMatches =
      sig.headerPatterns?.filter((h) => {
        const v = headers[h.name.toLowerCase()];
        if (!v) return false;
        return h.pattern === 'present' ? true : h.pattern.test(v);
      }).length ?? 0;

    const totalMatches = htmlMatches + headerMatches;
    if (totalMatches === 0) continue;
    // Each unique signal is independent evidence; 1 match = 0.7 confidence, scales up.
    const score = Math.min(1, 0.7 + 0.15 * (totalMatches - 1));
    if (score > bestScore) {
      bestScore = score;
      bestCms = sig.cms;
    }
  }

  return { cms: bestScore >= 0.34 ? bestCms : 'custom', confidence: bestScore };
}
