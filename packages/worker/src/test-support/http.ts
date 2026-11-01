import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A loopback HTTP server for tests that records each request it receives. */
export interface FixtureServer {
  /** `http://127.0.0.1:<port>` */
  base: string;
  port: number;
  requests: Array<{ url: string; headers: http.IncomingHttpHeaders }>;
  close(): Promise<void>;
}

export async function startServer(
  handler: http.RequestListener,
  host = '127.0.0.1',
): Promise<FixtureServer> {
  const requests: FixtureServer['requests'] = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url ?? '/', headers: req.headers });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
    port,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
