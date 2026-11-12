/**
 * The frame every v2 email's HTML shares: one column at most 600 px wide, system fonts, light and dark
 * colours by `prefers-color-scheme` for the clients that read it, and a footer saying why the message
 * was sent. `body` is HTML a template built from escaped values (escape.ts); nothing here escapes it.
 * The unsubscribe link, when given, is a URL this code signed (unsubscribe-token.ts), never a crawled one.
 */
import { html } from './escape';

export interface LayoutInput {
  /** The message's title, shown at the top; plain text. */
  title: string;
  /** Escaped HTML of the message's body. */
  body: string;
  /** Why the recipient got this, one plain-text sentence. */
  why: string;
  /** The signed unsubscribe URL, for alert and summary mail only (D7). */
  unsubscribeUrl?: string;
}

const STYLE = `
  body{margin:0;padding:0;background:#f7f3ea;color:#1f1b16;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:600px;margin:0 auto;padding:24px 16px}
  .card{background:#ffffff;border-radius:8px;padding:24px}
  h1{font-size:20px;line-height:1.3;margin:0 0 16px}
  a{color:#b4470e}
  .foot{color:#6b6257;font-size:12px;padding:16px 4px}
  @media (prefers-color-scheme: dark){
    body{background:#171512;color:#f1ece4}
    .card{background:#211e1a}
    a{color:#f0965c}
    .foot{color:#a79d90}
  }`;

export function layout(input: LayoutInput): string {
  const unsubscribe = input.unsubscribeUrl
    ? ` <a href="${html(input.unsubscribeUrl)}">Unsubscribe</a>.`
    : '';
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    `<title>${html(input.title)}</title><style>${STYLE}</style></head>`,
    `<body><div class="wrap"><div class="card"><h1>${html(input.title)}</h1>${input.body}</div>`,
    `<div class="foot">${html(input.why)}${unsubscribe}<br>Crawlmouse · crawlmouse.com</div></div></body></html>`,
  ].join('');
}
