// Grade-forward, grade-adaptive share payloads + whitelisted multi-channel intent URLs (SPEC 03
// Part 4). Pure + unit-tested. Share text is built from grade/score only (engine data, never
// crawled content), and every URL/text is encodeURIComponent'd — no param injection / open redirect.

import { noGradeShareText } from '@/lib/refusal-copy';

/** Tunable: score >= this = a proud flex; below = a curiosity/challenge. */
export const PROUD_THRESHOLD = 70;

export interface ShareMessage {
  proud: boolean;
  text: string;
}

/**
 * SPEC 5.1a Stage 4 — a withheld verdict has NO share text of the graded form.
 *
 * The graded copy is first-person and boastful ("I scored B+/81"). A refusal must not inherit that
 * frame: the approved copy's rule is **never "I scored —"**, because there is no score to be proud or
 * sheepish about, and a dash in the slot the reader expects a letter in still reads as a verdict.
 *
 * `proud` is false on that branch, but that is frame selection, not judgement. Nothing in the refusal
 * text says the site is bad; it says what Crawlmouse could measure.
 */
export function shareMessage(
  grade: string | null,
  score: number | null,
  threshold = PROUD_THRESHOLD,
  domain?: string | null,
): ShareMessage {
  // BOTH halves required — a half-written verdict must never produce "I scored B+/null".
  if (grade === null || score === null) {
    return { proud: false, text: noGradeShareText(domain) };
  }
  const proud = score >= threshold;
  return {
    proud,
    text: proud
      ? `I scored ${grade}/${score} on internal linking 💪 How's your site?`
      : `My site got ${grade}/${score} on internal linking 👀 What's yours?`,
  };
}

export type ShareChannel = 'x' | 'linkedin' | 'whatsapp' | 'telegram' | 'facebook';

/** A standard, whitelisted share-intent URL. `shareUrl` is the public/report URL being shared. */
export function shareIntentUrl(channel: ShareChannel, shareUrl: string, text: string): string {
  const u = encodeURIComponent(shareUrl);
  const t = encodeURIComponent(text);
  switch (channel) {
    case 'x':
      return `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case 'whatsapp':
      return `https://wa.me/?text=${t}%20${u}`;
    case 'telegram':
      return `https://t.me/share/url?url=${u}&text=${t}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
  }
}
