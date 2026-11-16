/**
 * The page a share link that no longer opens answers with (410), drawn as the v2 door's message
 * screens are (Check email, Continue): the app header with the brand, then a centred column with a
 * heading, one line and the support address. The route answers it as a plain response, which loads
 * no stylesheet and no next/font face, so the tokens it uses are written here and
 * `share-gone.test.ts` checks each against `styles/v2/tokens.css`; the typefaces fall back to the
 * stacks the tokens name after the next/font variable.
 */

/** The tokens the page uses, light then dark, as `styles/v2/tokens.css` declares them. */
export const GONE_TOKENS = {
  light: {
    '--v2-bg': '#f7f8fa',
    '--v2-fg': '#13161b',
    '--v2-fg2': '#3d4654',
    '--v2-line': '#e2e6eb',
    '--v2-brand': '#ff7849',
    '--v2-mark-line': '#1a1a18',
  },
  dark: {
    '--v2-bg': '#0f1317',
    '--v2-fg': '#e6e9ed',
    '--v2-fg2': '#b5bcc6',
    '--v2-line': '#242b33',
    '--v2-brand': '#ff7849',
    '--v2-mark-line': '#e6e9ed',
  },
} as const;

const declare = (tokens: Readonly<Record<string, string>>) =>
  Object.entries(tokens)
    .map(([name, value]) => `${name}:${value};`)
    .join('');

const DISPLAY = 'Charter, Georgia, serif';
const BODY = '-apple-system, BlinkMacSystemFont, sans-serif';

const STYLE = [
  `:root{${declare(GONE_TOKENS.light)}color-scheme:light}`,
  `@media (prefers-color-scheme: dark){:root{${declare(GONE_TOKENS.dark)}color-scheme:dark}}`,
  `body{margin:0;background:var(--v2-bg);color:var(--v2-fg);font-family:${BODY};font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}`,
  // The app header: 64px, a hairline under it, the brand at the wrap's gutter (PageShell).
  `header{border-bottom:1px solid var(--v2-line)}`,
  `.bar{box-sizing:border-box;max-width:1160px;margin:0 auto;padding:0 40px;height:64px;display:flex;align-items:center}`,
  `.brand{display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none}`,
  `.mark{display:block;flex:none}.mark line,.mark path{stroke:var(--v2-mark-line)}`,
  `.wordmark{font-family:${DISPLAY};font-weight:600;font-size:20px;letter-spacing:-0.025em;line-height:1}`,
  `.wordmark span{color:var(--v2-brand)}`,
  // The door's column (Door.module.css) and a Heading at size m (Heading.module.css).
  `main{box-sizing:border-box;max-width:1160px;margin:0 auto;padding:96px 40px 120px;display:flex;justify-content:center}`,
  `section{max-width:520px;width:100%}`,
  `h1{margin:0;font-family:${DISPLAY};font-weight:600;letter-spacing:-0.02em;font-size:26px;line-height:1.15}`,
  `p{margin:12px 0 0;color:var(--v2-fg2)}`,
  `a{color:inherit}main a{color:var(--v2-fg)}`,
  `@media (max-width:760px){.bar,main{padding-left:20px;padding-right:20px}main{padding-top:56px;padding-bottom:72px}h1{font-size:22px}}`,
].join('\n');

/**
 * The brand mark as `CrawlmouseMark` renders it at 24px with the class `mark`, written out: this
 * module is reached from server components and route handlers, where `react-dom/server` cannot be
 * imported. `share-gone.test.ts` renders the component and checks the two are equal.
 */
export const GONE_MARK =
  '<svg width="24" height="22" viewBox="0 0 48 44" fill="none" class="mark" xmlns="http://www.w3.org/2000/svg"><line x1="12" y1="10" x2="24" y2="26" stroke="#1a1a18" stroke-width="2.2" stroke-linecap="round"></line><line x1="36" y1="10" x2="24" y2="26" stroke="#1a1a18" stroke-width="2.2" stroke-linecap="round"></line><path d="M 32 31 Q 42 33, 45 42" stroke="#1a1a18" stroke-width="2.2" stroke-linecap="round" fill="none"></path><circle cx="12" cy="10" r="5" fill="#ff7849"></circle><circle cx="36" cy="10" r="5" fill="#ff7849"></circle><circle cx="24" cy="26" r="9" fill="#ff7849"></circle><circle cx="20.5" cy="24" r="1.3" fill="#fdfaf5"></circle><circle cx="27.5" cy="24" r="1.3" fill="#fdfaf5"></circle></svg>';

/** The support address, as `components/v2/footer-links.ts` names it (`share-gone.test.ts` checks). */
export const GONE_SUPPORT = 'support@crawlmouse.com';

/** Static: nothing of the request or the link is in it. */
export const GONE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This link no longer opens</title>
<style>
${STYLE}
</style>
</head>
<body>
<header><div class="bar"><a class="brand" href="/" aria-label="Crawlmouse home">${GONE_MARK}<span class="wordmark">crawl<span>mouse</span></span></a></div></header>
<main><section>
<h1>This link no longer opens</h1>
<p>It has expired or was withdrawn by the person who shared it. Ask them for a new link.</p>
<p>Something else: write to <a href="mailto:${GONE_SUPPORT}">${GONE_SUPPORT}</a>.</p>
</section></main>
</body>
</html>
`;
