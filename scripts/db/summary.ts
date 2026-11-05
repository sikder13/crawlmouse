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
  /** The rollback files the run executed, with their sha256. */
  rollbacks: Array<{ file: string; sha256: string }>;
  /** Production's fingerprint as read at the start of the run, md5 per section. */
  production: Record<string, string>;
}

const FILE_ENTRY = /^\d{14}_[a-z0-9_]+(\.revert)?\.sql$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MD5 = /^[0-9a-f]{32}$/;

/**
 * Reads a dry-run summary, refusing anything not shaped as `dryRun` writes it. The file comes from a
 * workflow artifact, so it is data to check, not to trust: `passed` must be the boolean true or
 * false, and every hash must look like one.
 */
export function parseSummary(text: string): DryRunSummary {
  const s = JSON.parse(text) as Partial<DryRunSummary>;
  const fileList = (v: unknown) =>
    Array.isArray(v) &&
    v.every(
      (f: { file?: unknown; sha256?: unknown }) =>
        typeof f?.file === 'string' &&
        FILE_ENTRY.test(f.file) &&
        typeof f.sha256 === 'string' &&
        SHA256.test(f.sha256),
    );
  const ok =
    typeof s.passed === 'boolean' &&
    typeof s.commit === 'string' &&
    typeof s.branch === 'string' &&
    Array.isArray(s.steps) &&
    fileList(s.files) &&
    fileList(s.rollbacks) &&
    typeof s.production === 'object' &&
    s.production !== null &&
    Object.values(s.production).every((v) => typeof v === 'string' && MD5.test(v));
  if (!ok) throw new Error('the dry-run summary is not shaped as dry-run.ts writes it');
  return s as DryRunSummary;
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
    '',
    'Rollback files run:',
    '',
    s.rollbacks.length > 0 ? filesTable(s.rollbacks) : '_No rollback file was run._',
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
