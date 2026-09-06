import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, ensureDir } from './paths.js';
import { USER_AGENT, TIMEOUT_MS } from './fetcher.js';

const API = 'https://tranco-list.eu/api/lists/date';
const DOWNLOAD = 'https://tranco-list.eu/download';

export interface TrancoList {
  listId: string;
  date: string;
  url: string;
  prefix: number;
  rows: { rank: number; domain: string }[];
}

interface TrancoApiResponse {
  list_id?: string;
  available?: boolean;
  failed?: boolean;
}

/**
 * Resolves a DATED Tranco list id, then downloads that list's top-`prefix` prefix as CSV.
 *
 * The dated id is what makes the panel reproducible: "the Tranco list" changes every day, so a
 * study that records only "we used Tranco" cannot be re-derived by anyone, including us. The id is
 * written into panel.json.
 *
 * The CSV is cached under .cache/ (gitignored) and keyed by list id, so a rebuild on the same day
 * re-reads the file instead of re-downloading ~2 MB.
 */
export async function fetchTrancoList(date: string, prefix: number): Promise<TrancoList> {
  const listId = await resolveListId(date);
  const url = `${DOWNLOAD}/${listId}/${prefix}`;
  ensureDir(CACHE_DIR);
  const cached = join(CACHE_DIR, `tranco-${listId}-${prefix}.csv`);

  let csv: string;
  if (existsSync(cached)) {
    csv = readFileSync(cached, 'utf8');
  } else {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS * 6),
      headers: { 'user-agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`Tranco download failed: HTTP ${res.status} for ${url}`);
    csv = await res.text();
    writeFileSync(cached, csv, 'utf8');
  }

  return { listId, date, url, prefix, rows: parseTrancoCsv(csv) };
}

async function resolveListId(date: string): Promise<string> {
  const res = await fetch(`${API}/${date}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    headers: { 'user-agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Tranco API failed: HTTP ${res.status} for date ${date}`);
  const json = (await res.json()) as TrancoApiResponse;
  if (!json.list_id || json.available === false || json.failed) {
    throw new Error(`Tranco has no available list for ${date}: ${JSON.stringify(json)}`);
  }
  return json.list_id;
}

/** `rank,domain` per line. Malformed lines are skipped rather than failing the run. */
export function parseTrancoCsv(csv: string): { rank: number; domain: string }[] {
  const rows: { rank: number; domain: string }[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const comma = line.indexOf(',');
    if (comma <= 0) continue;
    const rank = Number(line.slice(0, comma));
    const domain = line.slice(comma + 1).trim().toLowerCase();
    if (!Number.isInteger(rank) || rank <= 0 || !domain) continue;
    rows.push({ rank, domain });
  }
  return rows;
}

/**
 * Uniform strata across the rank window: take every Nth row rather than the head of the list, so
 * the candidate pool is not just mega-sites. `stride` is chosen to yield at least `want` candidates
 * when the window allows it.
 */
export function sampleUniform(
  rows: readonly { rank: number; domain: string }[],
  minRank: number,
  maxRank: number,
  want: number,
): { rank: number; domain: string }[] {
  const window = rows.filter((r) => r.rank >= minRank && r.rank <= maxRank);
  if (window.length === 0) return [];
  const stride = Math.max(1, Math.floor(window.length / Math.max(1, want)));
  const out: { rank: number; domain: string }[] = [];
  for (let i = 0; i < window.length; i += stride) out.push(window[i]!);
  return out;
}
