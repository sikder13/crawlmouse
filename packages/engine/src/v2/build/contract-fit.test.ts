/**
 * The engine's ContentFeatures (content/read.ts) and the contract's ContentFeaturesSchema, which the
 * worker writes on each crawl row, describe one shape: each is assignable to the other, so a field
 * added to one and not the other fails `tsc` here. The worker builds features with the engine's
 * reader and parses them with the schema (worker reader/read.ts contentFeatures).
 */
import { describe, expect, it } from 'vitest';
import type { ContentFeaturesRow } from '@crawlmouse/types/v2';
import type { ContentFeatures } from '../content/read.js';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same: Same<ContentFeatures, ContentFeaturesRow> = true;

describe('ContentFeatures and ContentFeaturesSchema', () => {
  it('are the same shape (checked by tsc)', () => {
    expect(same).toBe(true);
  });
});
