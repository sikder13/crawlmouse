/**
 * The link map's layout, shared by the server and the web app's crawl screen. Imported as
 * `@crawlmouse/engine/v2/layout`, a subpath that pulls in nothing from the crawler, so the browser
 * worker can load it.
 */
export * from './force-layout.js';
