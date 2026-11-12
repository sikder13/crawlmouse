/**
 * Readers the template tests (and C's) hold a rendered message to: every link target in its HTML, so
 * a test can require each to be one of ours, and every URL written in its text part. A text part is
 * plain text: a crawled string in it (a packet's URLs) is text a mail client may make clickable, which
 * no template can prevent, so `foreignTargets` reads the HTML's targets only.
 */
import { MAIL_ORIGIN } from '../links';
import type { RenderedMail } from '../types';

/** Every `href` and `src` value in the HTML, attribute-unescaped, in order. */
export function htmlTargets(html: string): string[] {
  return [...html.matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/gi)].map((m) =>
    m[1]!
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&'),
  );
}

/** Every http(s) URL written in the text part. */
export function textUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"]+/gi)].map((m) => m[0]);
}

/** The HTML's link targets that are not on our origin: the empty list for a safe message. */
export function foreignTargets(mail: RenderedMail): string[] {
  return htmlTargets(mail.html).filter((u) => !u.startsWith(`${MAIL_ORIGIN}/`));
}
