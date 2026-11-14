/**
 * Loaded into `next start` by the walk (NODE_OPTIONS=--import), never by the product. Two things:
 * the Stripe SDK's requests to api.stripe.com, by `https.request` or by `fetch`, go to the stand-in's
 * Stripe (./stripe.ts) over plain HTTP on 127.0.0.1, and the walk's site names resolve (below). run.sh sets WALK_STRIPE_PORT.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

const port = Number(process.env.WALK_STRIPE_PORT);
if (!Number.isInteger(port) || port <= 0)
  throw new Error('stripe-preload: WALK_STRIPE_PORT is not set');

const original = https.request;
https.request = function request(options, callback) {
  const host =
    typeof options === 'object' && options !== null ? options.host || options.hostname : null;
  if (host !== 'api.stripe.com') return original.apply(this, arguments);
  // An https agent and cipher list do not apply to the plain-HTTP stand-in.
  const rest = { ...options };
  delete rest.agent;
  delete rest.ciphers;
  delete rest.protocol;
  const req = http.request(
    { ...rest, host: '127.0.0.1', hostname: '127.0.0.1', port, path: `/stripe${options.path}` },
    callback,
  );
  // The SDK writes the request once its socket says the TLS handshake is done; a plain socket says
  // `connect` only, so it is told the other as well.
  req.once('socket', (socket) => socket.once('connect', () => socket.emit('secureConnect')));
  return req;
};

// The SDK's fetch-based client (the build may bundle that one) goes the same way.
const originalFetch = globalThis.fetch;
globalThis.fetch = function walkFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== 'api.stripe.com') return originalFetch(input, init);
  const target = `http://127.0.0.1:${port}/stripe${url.pathname}${url.search}`;
  return input instanceof Request ? originalFetch(new Request(target, input), init) : originalFetch(target, init);
};

/**
 * The walk's site names, `<name>.walk.crawlmouse.com`, exist only here: the SSRF guard
 * (packages/engine/src/ssrf-guard.ts) looks a host up before a site is admitted, so each one is
 * answered with crawlmouse.com's own addresses. Nothing connects to them; the walk's checks are
 * finished from the recorded crawl. Every other name is looked up as it would be.
 */
const lookup = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = function walkLookup(hostname, options) {
  if (typeof hostname === 'string' && hostname.endsWith('.walk.crawlmouse.com')) {
    return lookup('crawlmouse.com', options);
  }
  return lookup(hostname, options);
};
