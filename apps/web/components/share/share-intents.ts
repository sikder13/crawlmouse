// Grade-forward, grade-adaptive share payloads + whitelisted multi-channel intent URLs (SPEC 03
// Part 4). Pure + unit-tested. Share text is built from grade/score only (engine data, never
// crawled content), and every URL/text is encodeURIComponent'd — no param injection / open redirect.

/** Tunable: score >= this = a proud flex; below = a curiosity/challenge. */
export const PROUD_THRESHOLD = 70;

export interface ShareMessage {
  proud: boolean;
  text: string;
}

export function shareMessage(grade: string, score: number, threshold = PROUD_THRESHOLD): ShareMessage {
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
