/**
 * Loaded into `next start` by the walk (NODE_OPTIONS=--import), never by the product. Three things:
 * - the Stripe SDK's requests to api.stripe.com, through `https.request`, `https.get` or `fetch`, go to
 *   the stand-in's Stripe (./stripe.ts) over plain HTTP on 127.0.0.1 (run.sh sets WALK_STRIPE_PORT);
 * - the walk's site names resolve, for the SSRF guard's lookup (below);
 * - no socket of this process reaches the addresses those names resolve to.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const port = Number(process.env.WALK_STRIPE_PORT);
if (!Number.isInteger(port) || port <= 0)
  throw new Error('walk preload: WALK_STRIPE_PORT is not set');

const STRIPE = 'api.stripe.com';

/** `https.request`'s three call forms — (options), (url), (url, options) — as one options object. */
function optionsOf(args) {
  const [first, second] = args;
  const fromUrl = (u) => ({
    protocol: u.protocol,
    host: u.hostname,
    hostname: u.hostname,
    port: u.port,
    path: `${u.pathname}${u.search}`,
  });
  if (typeof first === 'string' || first instanceof URL) {
    const base = fromUrl(new URL(first));
    return typeof second === 'object' && second !== null ? { ...base, ...second } : base;
  }
  return typeof first === 'object' && first !== null ? first : {};
}

function toStandin(options, callback) {
  // An https agent and cipher list do not apply to the plain-HTTP stand-in.
  const rest = { ...options };
  delete rest.agent;
  delete rest.ciphers;
  delete rest.protocol;
  const req = http.request(
    {
      ...rest,
      host: '127.0.0.1',
      hostname: '127.0.0.1',
      port,
      path: `/stripe${options.path ?? '/'}`,
    },
    callback,
  );
  // The SDK writes the request once its socket says the TLS handshake is done; a plain socket says
  // `connect` only, so it is told the other as well.
  req.once('socket', (socket) => socket.once('connect', () => socket.emit('secureConnect')));
  return req;
}

for (const name of ['request', 'get']) {
  const original = https[name];
  https[name] = function walkHttps(...args) {
    const options = optionsOf(args);
    if ((options.host || options.hostname) !== STRIPE) return original.apply(this, args);
    const callback = args.find((a) => typeof a === 'function');
    const req = toStandin(options, callback);
    if (name === 'get') req.end();
    return req;
  };
}

// The SDK's fetch-based client (the build may bundle that one) goes the same way.
const originalFetch = globalThis.fetch;
globalThis.fetch = function walkFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== STRIPE) return originalFetch(input, init);
  const target = `http://127.0.0.1:${port}/stripe${url.pathname}${url.search}`;
  return input instanceof Request
    ? originalFetch(new Request(target, input), init)
    : originalFetch(target, init);
};

/**
 * The walk's site names, `<name>.walk.crawlmouse.com`, exist only here: the SSRF guard
 * (packages/engine/src/ssrf-guard.ts) looks a host up with `dns.promises.lookup` before a site is
 * admitted, so each one is answered with crawlmouse.com's own addresses. The walk's checks are
 * finished from the recorded crawl; the guard below refuses any socket to an address answered here.
 */
const WALK = '.walk.crawlmouse.com';
const answered = new Set();
const lookup = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = async function walkLookup(hostname, options) {
  if (typeof hostname !== 'string' || !hostname.endsWith(WALK)) return lookup(hostname, options);
  const result = await lookup('crawlmouse.com', options);
  for (const r of Array.isArray(result) ? result : [result]) answered.add(r.address);
  return result;
};

/** Every TCP connect this process makes: by address, and by name once its lookup answers. */
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function walkConnect(...args) {
  // `net.connect` and undici pass Node's normalized form, `[[options, callback]]`; a direct call passes
  // `(options)` or `(port, host)`.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const target = typeof first === 'object' && first !== null ? first : { host: args[1] };
  const host = String(target.host ?? '');
  if (host.endsWith(WALK) || answered.has(host)) {
    throw new Error(`walk preload: a connection to ${host} was refused (the walk reaches no site)`);
  }
  this.once('lookup', (err, address) => {
    if (!err && answered.has(address)) {
      this.destroy(new Error(`walk preload: a connection to ${address} was refused`));
    }
  });
  return connect.apply(this, args);
};
