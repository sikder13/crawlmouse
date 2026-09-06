import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PanelFile } from './types.js';

/** Resolved from this file, not process.cwd(), so the commands work from any directory. */
export const ROOT = dirname(fileURLToPath(import.meta.url));
export const PANEL_PATH = join(ROOT, 'panel.json');
export const SNAPSHOTS_DIR = join(ROOT, 'snapshots');
export const REPORTS_DIR = join(ROOT, 'reports');
export const CACHE_DIR = join(ROOT, '.cache');

export const SNAPSHOT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Snapshot run directories that already exist, sorted. A run is a date, and dates sort. */
export function existingSnapshotDates(): string[] {
  if (!existsSync(SNAPSHOTS_DIR)) return [];
  return readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SNAPSHOT_DATE_RE.test(d.name))
    .map((d) => d.name)
    .sort();
}

/**
 * THE FREEZE. The panel is the study's denominator: every percentage in the report is "of these
 * domains". Rebuilding it after a snapshot exists would silently change what the before/after
 * numbers are a comparison of, so once any run has been taken the panel is immutable and the
 * command refuses rather than asking.
 */
export function assertPanelNotFrozen(): void {
  const dates = existingSnapshotDates();
  if (dates.length === 0) return;
  throw new Error(
    `panel.json is FROZEN: ${dates.length} snapshot run(s) already exist (${dates.join(', ')}).\n` +
      'The panel is the denominator for every published percentage, so it cannot change once a run\n' +
      'has been taken. To start a different study, use a new directory.',
  );
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function loadPanel(): PanelFile {
  if (!existsSync(PANEL_PATH)) {
    throw new Error(`No panel at ${PANEL_PATH}. Run \`pnpm research:build-panel\` first.`);
  }
  return JSON.parse(readFileSync(PANEL_PATH, 'utf8')) as PanelFile;
}

/** `--flag=value` or `--flag value`; returns undefined when absent. */
export function argValue(argv: readonly string[], flag: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${flag}=`));
  if (eq) return eq.slice(flag.length + 3);
  const i = argv.indexOf(`--${flag}`);
  if (i !== -1 && i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) return argv[i + 1];
  return undefined;
}

export function argNumber(argv: readonly string[], flag: string): number | undefined {
  const raw = argValue(argv, flag);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${flag} must be a number, got "${raw}"`);
  return n;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
