import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formattedPacketSpec, renderPacketSpec, SPEC_URL } from './spec.js';
import { PACKETS } from './registry.js';

describe('docs/specs/v2/30-fix-packets.md', () => {
  it('is what the code renders it to, as prettier leaves it', async () => {
    expect(readFileSync(SPEC_URL, 'utf8')).toBe(await formattedPacketSpec());
  });

  it('has a section for each fix type of the registry', () => {
    const rendered = renderPacketSpec();
    for (const type of Object.keys(PACKETS)) expect(rendered).toContain(`### \`${type}\`\n`);
  });

  it('answers each question of the step, Q1 to Q10', () => {
    const rendered = renderPacketSpec();
    for (let q = 1; q <= 10; q++) expect(rendered).toContain(`**Q${q}.**`);
  });

  it('records the contract change as the owner approved it', () => {
    expect(renderPacketSpec()).toContain('OWNER-APPROVED NON-ADDITIVE CHANGE to `packages/types`');
  });
});
