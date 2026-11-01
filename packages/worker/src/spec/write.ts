/** Writes docs/specs/v2/12-crawl-worker.md and the generated section of docs/ops/worker-runbook.md. */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  RUNBOOK_PATH,
  SPEC_PATH,
  prettierMarkdown,
  renderSpec,
  withGeneratedSection,
} from './render.js';

writeFileSync(SPEC_PATH, await prettierMarkdown(renderSpec(), SPEC_PATH));
writeFileSync(
  RUNBOOK_PATH,
  await prettierMarkdown(withGeneratedSection(readFileSync(RUNBOOK_PATH, 'utf8')), RUNBOOK_PATH),
);
