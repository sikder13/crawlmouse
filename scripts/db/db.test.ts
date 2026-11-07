import { describe, expect, it } from 'vitest';
import { readOnlyApi } from './db';

/** A fetch stand-in that records the request and answers with the given status and body. */
function fakeFetch(status: number, body: string) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('readOnlyApi', () => {
  it('posts the query to the read-only endpoint with the token, and returns the rows', async () => {
    const rows = [{ version: '1', statements: ['a', 'b'] }];
    const f = fakeFetch(201, JSON.stringify(rows));
    const db = readOnlyApi('abcdefghijklmnopqrst', 'tok', f.impl);
    expect(await db.query('select 1')).toEqual(rows);
    expect(f.calls[0]!.url).toBe(
      'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query/read-only',
    );
    expect(f.calls[0]!.init.method).toBe('POST');
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ query: 'select 1' });
  });

  it('fails with the status on an error response', async () => {
    const db = readOnlyApi('abcdefghijklmnopqrst', 'tok', fakeFetch(403, 'forbidden').impl);
    await expect(db.query('select 1')).rejects.toThrow(/HTTP 403 forbidden/);
  });

  it('refuses parameters, writes and transactions', async () => {
    const db = readOnlyApi('abcdefghijklmnopqrst', 'tok', fakeFetch(201, '[]').impl);
    await expect(db.query('select $1', [1])).rejects.toThrow(/takes no parameters/);
    await expect(db.exec('select 1')).rejects.toThrow(/cannot write/);
    await expect(db.transaction(async () => 1)).rejects.toThrow(/cannot write/);
  });
});
