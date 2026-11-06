/**
 * The render user agent is the one the v2 fixtures record on their `identity_role: render` rows, as
 * `identity_sent` and as the User-Agent request header.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RENDER_USER_AGENT } from './client.js';

const DIR = new URL('../../../../../apps/web/lib/fixtures/v2/', import.meta.url);

interface Row {
  identity_role?: string;
  identity_sent?: string;
  request_headers?: { name: string; value: string }[];
}

function renderRows(): { file: string; row: Row }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((file) => {
      const rows: Row[] = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          if ((v as Row).identity_role === 'render') rows.push(v as Row);
          Object.values(v).forEach(walk);
        }
      };
      walk(JSON.parse(readFileSync(new URL(file, DIR), 'utf8')));
      return rows.map((row) => ({ file, row }));
    });
}

describe('the render user agent', () => {
  const rows = renderRows();

  it('has fixture rows to be checked against', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('is what every render row sent', () => {
    expect(rows.map(({ row }) => row.identity_sent)).toEqual(rows.map(() => RENDER_USER_AGENT));
  });

  it('is what every render row’s User-Agent header carried', () => {
    const headers = rows.map(
      ({ row }) => row.request_headers?.find((h) => h.name.toLowerCase() === 'user-agent')?.value,
    );
    expect(headers).toEqual(rows.map(() => RENDER_USER_AGENT));
  });
});
