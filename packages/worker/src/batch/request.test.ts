import { describe, expect, it } from 'vitest';
import { BatchRequestSchema } from './request.js';

/**
 * What a batch request may name, as literal numbers: the bounds live in the engine
 * (`packages/engine/src/v2/batch-bounds.ts`), which the check builder's planners share, and a change
 * made there would otherwise reach this deployed schema with no worker test going red.
 */

const common = {
  check_id: '00000000-0000-4000-8000-0000000000c9',
  site_id: '00000000-0000-4000-8000-0000000000a9',
  batch: 1,
  nonce: 'nonce-0000000000000001',
  jwt: 'h.p.s',
  budget: { max_requests: 10, max_bytes: 1000, max_seconds: 10 },
};
const url = (length: number) => {
  const base = 'https://example.com/';
  return `${base}${'x'.repeat(length - base.length)}`;
};
const key = (length: number) => `/${'k'.repeat(length - 1)}`;

describe('BatchRequestSchema', () => {
  it('takes a URL of 2,048 characters and refuses one of 2,049, in a crawl batch and an access batch', () => {
    expect(url(2048)).toHaveLength(2048);
    expect(
      BatchRequestSchema.safeParse({ ...common, kind: 'crawl', urls: [url(2048)] }).success,
    ).toBe(true);
    expect(
      BatchRequestSchema.safeParse({ ...common, kind: 'crawl', urls: [url(2049)] }).success,
    ).toBe(false);
    const page = (u: string) => ({
      ...common,
      kind: 'access',
      pages: [{ url: u, template_key: '/' }],
    });
    expect(BatchRequestSchema.safeParse(page(url(2048))).success).toBe(true);
    expect(BatchRequestSchema.safeParse(page(url(2049))).success).toBe(false);
  });

  it('takes a template key of 512 characters and refuses one of 513', () => {
    const access = (k: string) => ({
      ...common,
      kind: 'access',
      pages: [{ url: 'https://example.com/a', template_key: k }],
    });
    expect(key(512)).toHaveLength(512);
    expect(BatchRequestSchema.safeParse(access(key(512))).success).toBe(true);
    expect(BatchRequestSchema.safeParse(access(key(513))).success).toBe(false);
  });
});
