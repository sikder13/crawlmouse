import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RUNBOOK_PATH,
  SPEC_PATH,
  prettierMarkdown,
  renderSpec,
  withGeneratedSection,
} from './render.js';

describe('generated documents', () => {
  it('docs/specs/v2/12-crawl-worker.md is exactly what the code renders', async () => {
    expect(readFileSync(SPEC_PATH, 'utf8')).toBe(await prettierMarkdown(renderSpec(), SPEC_PATH));
  });

  it("docs/ops/worker-runbook.md's verdict section is exactly what the code renders", async () => {
    const runbook = readFileSync(RUNBOOK_PATH, 'utf8');
    expect(runbook).toBe(await prettierMarkdown(withGeneratedSection(runbook), RUNBOOK_PATH));
  });
});
