import { appendFileSync, writeFileSync } from 'node:fs';
import type { MigrationFile } from './files';
import type { Fingerprint } from './fingerprint';

/** What a dry run records, and what the production apply checks before it runs. */
export interface DryRunSummary {
  passed: boolean;
  /** The commit whose files were applied. */
  commit: string;
  branch: string;
  finishedAt: string;
  steps: Array<{ step: string; result: string }>;
  files: Array<{ file: string; sha256: string }>;
  /** Production's fingerprint as read at the start of the run, md5 per section. */
  production: Record<string, string>;
}

export function fileList(files: MigrationFile[]): DryRunSummary['files'] {
  return files.map((f) => ({ file: f.file, sha256: f.sha256 }));
}

export function digests(fp: Fingerprint): Record<string, string> {
  return Object.fromEntries([...fp.entries()].map(([s, v]) => [s, v.md5]));
}

export function filesTable(files: DryRunSummary['files']): string {
  if (files.length === 0) return '_No migration files were pending._';
  return [
    '| File | sha256 |',
    '| --- | --- |',
    ...files.map((f) => `| \`${f.file}\` | \`${f.sha256}\` |`),
  ].join('\n');
}

export function renderDryRun(s: DryRunSummary): string {
  return [
    `### Migration dry run: ${s.passed ? 'passed' : 'FAILED'}`,
    '',
    `Commit \`${s.commit}\`, Supabase branch \`${s.branch}\`, finished ${s.finishedAt}.`,
    '',
    '| Step | Result |',
    '| --- | --- |',
    ...s.steps.map((r) => `| ${r.step} | ${r.result.replace(/\n/g, '<br>')} |`),
    '',
    'Files applied, with the sha256 of the bytes production will receive:',
    '',
    filesTable(s.files),
  ].join('\n');
}

/** Appends markdown to the job summary when running in GitHub Actions, and writes it to a file. */
export function publish(
  markdown: string,
  out?: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  if (out) writeFileSync(out, `${markdown}\n`);
}
