/**
 * The lab site crawled over HTTP by the worker, in process: the recording path (generate.ts `record`)
 * still gives the recorded fixture, and the live proof's variant of the site gives a check whose
 * packets fail their own verify commands on the site as served.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AccessTest, BatchResult } from '@crawlmouse/types/v2';
import { record, renamed } from '../../../fixtures/v2/build/generate.js';
import { liveProof } from '../../../fixtures/v2/build/live-proof.js';

const FIXTURE = new URL('../../../fixtures/v2/build/', import.meta.url);
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const recorded = (dir: string) =>
  readdirSync(new URL(`${dir}/`, FIXTURE))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readFileSync(new URL(`${dir}/${f}`, FIXTURE), 'utf8'));

/** Access test ids in row order, as generate.ts numbers them before writing. */
function numbered(batches: BatchResult[]): BatchResult[] {
  let i = 0;
  return batches.map((b) =>
    b.kind !== 'access'
      ? b
      : {
          ...b,
          access_tests: b.access_tests.map(
            (t): AccessTest => ({
              ...t,
              id: `e0000000-0000-4000-8000-${String(++i).padStart(12, '0')}`,
            }),
          ),
        },
  );
}

describe('the lab site, crawled over HTTP', () => {
  it('as recorded: the worker’s batches and the render outcome are the recorded files, byte for byte', async () => {
    const { base, batches, render } = await record({ linkRedirectTarget: false });
    expect(numbered(renamed(batches, base)).map(json)).toEqual(recorded('batches'));
    expect(json(render)).toBe(readFileSync(new URL('render.json', FIXTURE), 'utf8'));
  }, 60_000);

  it('with its guides’ sections left to JavaScript: the guides fix opens, and both packets fail their check', async () => {
    const proof = await liveProof();
    expect(proof).toMatch(/^## \d+\. Serve the text of guides without JavaScript$/m);
    expect(proof).toMatch(/^## \d+\. Let ClaudeBot through the user-agent rule$/m);
    expect(proof).toContain(
      '- The template `/guides/{slug}` serves its main content by JavaScript. The audit rendered 3 of its 3 graded pages in a browser, and without JavaScript each of them is an empty shell.',
    );
    const statuses = [...proof.matchAll(/before any fix: exit status (\d+)/g)].map((m) => m[1]);
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    for (const s of statuses) expect(s).not.toBe('0');
    // the output does not name the server's port
    expect(proof).not.toMatch(/127\.0\.0\.1/);
  }, 60_000);
});
