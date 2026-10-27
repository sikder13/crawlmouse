import http from 'node:http';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';

/**
 * Fixture server for spike spec 2.9 (SSRF through the worker). Plain node:http. The routes that need a
 * public address (302 to a private address, gzip bomb, 11 MB body, slow drip) are meant to be served from
 * somewhere the worker can reach; the literal-address cases need no server at all.
 */

export const ELEVEN_MB = 11 * 1024 * 1024;
export const BOMB_DECODED_BYTES = 12 * 1024 * 1024;

let bombCache: Buffer | undefined;
/** 12 MB of zeros as gzip: well over 100:1, decoded size above the 10 MB cap. */
export function gzipBomb(): Buffer {
  bombCache ??= gzipSync(Buffer.alloc(BOMB_DECODED_BYTES));
  return bombCache;
}

export interface SsrfCase {
  id: string;
  /** Path on the fixture server, or an absolute URL when no server is needed. */
  target: { kind: 'absolute'; url: string } | { kind: 'fixture'; path: string };
  /** What safeFetch must do: refuse before any body, or abort once the body exceeds the cap. */
  expect: 'refused' | 'truncated';
}

export const SSRF_CASES: SsrfCase[] = [
  { id: 'metadata-literal', target: { kind: 'absolute', url: 'http://169.254.169.254/latest/meta-data/' }, expect: 'refused' },
  { id: 'v4-mapped-loopback', target: { kind: 'absolute', url: 'http://[::ffff:127.0.0.1]/' }, expect: 'refused' },
  { id: 'redirect-to-metadata', target: { kind: 'fixture', path: '/ssrf/302-metadata' }, expect: 'refused' },
  { id: 'redirect-to-v4-mapped', target: { kind: 'fixture', path: '/ssrf/302-mapped' }, expect: 'refused' },
  { id: 'gzip-bomb', target: { kind: 'fixture', path: '/ssrf/gzip-bomb' }, expect: 'truncated' },
  { id: 'body-11mb', target: { kind: 'fixture', path: '/ssrf/body-11mb' }, expect: 'truncated' },
];

export function createSsrfFixtureServer(): http.Server {
  return http.createServer((req, res) => {
    switch (req.url) {
      case '/ssrf/302-metadata':
        res.statusCode = 302;
        res.setHeader('location', 'http://169.254.169.254/latest/meta-data/');
        res.end();
        return;
      case '/ssrf/302-mapped':
        res.statusCode = 302;
        res.setHeader('location', 'http://[::ffff:127.0.0.1]/');
        res.end();
        return;
      case '/ssrf/gzip-bomb': {
        const b = gzipBomb();
        res.setHeader('content-type', 'text/html');
        res.setHeader('content-encoding', 'gzip');
        res.setHeader('content-length', String(b.length));
        res.end(b);
        return;
      }
      case '/ssrf/body-11mb': {
        res.setHeader('content-type', 'text/html');
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        let sent = 0;
        const pump = () => {
          while (sent < ELEVEN_MB) {
            sent += chunk.length;
            if (!res.write(chunk)) {
              res.once('drain', pump);
              return;
            }
          }
          res.end();
        };
        pump();
        return;
      }
      default:
        res.statusCode = 404;
        res.end('');
    }
  });
}

export async function listen(server: http.Server, host = '127.0.0.1', port = 0): Promise<string> {
  await new Promise<void>((r) => server.listen(port, host, r));
  return `http://${host}:${(server.address() as AddressInfo).port}`;
}

export async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
