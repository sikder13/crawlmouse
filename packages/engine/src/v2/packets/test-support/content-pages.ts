/** HTML pages for the content packets' two-state tests. */

export const ld = (node: unknown, space?: number): string =>
  `<script type="application/ld+json">${JSON.stringify(node, null, space)}</script>`;

/** A page with `head` in its head and `body` in its main element, between a menu and a footer. */
export const page = (head: string, body: string): string =>
  `<!doctype html><html><head><title>t</title>${head}</head><body>` +
  `<nav><a href="/">Home</a></nav><main>${body}</main><footer><p>Built Site</p></footer></body></html>`;

/** `n` words that end no sentence. */
export const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

/** A paragraph of `n` words that holds no sentence the direct-answer check accepts. */
export const filler = (n: number): string => `<p>${words(n)}</p>`;
