import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { END, GO_LIVE_PATH, START, blockOf, renderBlock, renderFile } from './checklist';
import { MANUAL, PRECONDITIONS } from './preconditions';

describe('docs/ops/go-live.md', () => {
  it("holds the registry's manual rows exactly as rendered", async () => {
    const current = readFileSync(GO_LIVE_PATH, 'utf8');
    const rendered = await renderFile(current);
    expect(blockOf(current)).not.toBeNull();
    expect(blockOf(current)).toBe(blockOf(rendered));
  });
});

describe('the render', () => {
  const block = renderBlock();
  it('has one box per manual row and none for an automatic one', () => {
    for (const p of MANUAL) expect(block).toContain(`- [ ] \`${p.id}\``);
    for (const p of PRECONDITIONS.filter((x) => x.check.kind === 'auto')) {
      expect(block).not.toContain(`\`${p.id}\``);
    }
    expect(block.match(/^- \[ \] /gm)).toHaveLength(MANUAL.length);
  });

  it('puts each box under the step it gates', () => {
    for (const p of MANUAL) {
      const heading = block.lastIndexOf('#### Before step', block.indexOf(`\`${p.id}\``));
      expect(block.slice(heading, heading + 18), p.id).toBe(`#### Before step ${p.gates}`);
    }
  });

  it("says under step 2 that step 1's exit check gates it", () => {
    const at = block.indexOf('#### Before step 2');
    expect(block.slice(at, block.indexOf('- [ ]', at))).toContain("Step 1's exit check");
  });

  it('keeps what the document holds outside the markers', async () => {
    const doc = `# Go live\n\nIntro.\n\n${START}\nold\n${END}\n\n## After\n`;
    const out = await renderFile(doc);
    expect(out.startsWith('# Go live\n\nIntro.\n')).toBe(true);
    expect(out).toContain('## After');
    expect(out).not.toContain('\nold\n');
  });

  it('fails the file test when a box is ticked or changed', async () => {
    const current = readFileSync(GO_LIVE_PATH, 'utf8');
    const ticked = current.replace('- [ ] ', '- [x] ');
    expect(blockOf(ticked)).not.toBe(blockOf(await renderFile(current)));
  });
});
