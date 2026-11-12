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
import { identifiersIn } from './test-support/content.js';
import { outsideCodeSpans } from './test-support/hostile.js';

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
      '- The HTML response of the template `/guides/{slug}` holds far fewer words than its pages show once rendered in a browser: the difference is content added in the browser. The audit rendered each of its 3 graded pages in a browser.',
    );
    const statuses = [...proof.matchAll(/before any fix: exit status (\d+)/g)].map((m) => m[1]);
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    for (const s of statuses) expect(s).not.toBe('0');
    // the output does not name the server's port
    expect(proof).not.toMatch(/127\.0\.0\.1/);

    // each stack is named in words, and no identifier of ours is printed outside a command
    expect(proof).toContain('#### Change: any stack');
    expect(proof).toContain('#### Change: Next.js');
    expect(proof).not.toMatch(/^#### Change \(/m);
    const prose = proof
      .replace(/^```[^]*?^```$/gm, '')
      .split('\n')
      .map(outsideCodeSpans);
    for (const text of prose) expect(identifiersIn(text), text).toEqual([]);

    // the readable command comes first, with what it printed on the site as audited
    const edge = proof.slice(proof.indexOf('Let ClaudeBot through the user-agent rule'));
    const section = edge.slice(0, edge.indexOf('\n## '));
    expect(section.indexOf('#### See it')).toBeGreaterThan(section.indexOf('### Verify'));
    expect(section.indexOf('#### Exact check')).toBeGreaterThan(section.indexOf('#### See it'));
    expect(section).toMatch(
      /#### See it\n\n```sh\ncurl -sS -o \/dev\/null -w '%\{http_code\}\\n' -A 'ClaudeBot' '[^']+'\n```\n\nToday: `403`: [^\n]+\n\nAfter the fix: `200`\. [^\n]+\n\nRun against the local server, before any fix, it printed:\n\n```\n403\n```\n/,
    );
    expect(section).toMatch(/#### Exact check\n\n```sh\ncurl -sS -o \/dev\/null -D - /);
    const guides = proof.slice(proof.indexOf('Serve the text of guides without JavaScript'));
    expect(guides.slice(0, guides.indexOf('\n## '))).toMatch(
      /Today: The audit counted \d+ words in this page’s HTML response\.[^\n]+\n\nAfter the fix: [^\n]+\n\nRun against the local server, before any fix, it printed:\n\n```\n\d+\n```\n/,
    );
  }, 60_000);
});
