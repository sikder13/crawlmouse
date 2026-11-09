/**
 * Renders the inventory sections of docs/specs/v2/v1-audit.md from docs/ops/v1-inventory.json, so
 * the report's counts and lists are built by iterating the data (OPERATING-RULES §10). The report
 * holds each rendered block between `<!-- v1-inventory:<name> -->` and `<!-- /v1-inventory:<name> -->`;
 * v1-inventory.test.ts fails when a block differs from what this file renders, and rewrites the
 * blocks when run with V1_INVENTORY_WRITE=1.
 */
export type Ruling = 'retire' | 'keep' | 'delete';
export type InventoryEntry = {
  kind: string;
  path: string;
  url?: string;
  ruling: Ruling;
  reason: string;
  evidence: string;
  replacedBy?: string;
  redirect?: string;
};

const KINDS = ['page', 'metadata', 'route', 'inngest', 'cron', 'table'] as const;
const RULINGS: readonly Ruling[] = ['keep', 'retire', 'delete'];

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const label = (e: InventoryEntry) => cell(e.url ? `\`${e.url}\` (\`${e.path}\`)` : `\`${e.path}\``);

export function renderCounts(items: readonly InventoryEntry[]): string {
  const count = (kind: string | null, ruling: Ruling | null) =>
    items.filter(
      (e) => (kind === null || e.kind === kind) && (ruling === null || e.ruling === ruling),
    ).length;
  const kinds = [
    ...KINDS,
    ...new Set(items.map((e) => e.kind).filter((k) => !KINDS.includes(k as never))),
  ];
  const rows = kinds.map(
    (k) => `| ${k} | ${RULINGS.map((r) => count(k, r)).join(' | ')} | ${count(k, null)} |`,
  );
  return [
    `| kind | ${RULINGS.join(' | ')} | total |`,
    `| --- | ${RULINGS.map(() => '---:').join(' | ')} | ---: |`,
    ...rows,
    `| **all** | ${RULINGS.map((r) => count(null, r)).join(' | ')} | ${items.length} |`,
  ].join('\n');
}

export function renderCutover(items: readonly InventoryEntry[]): string {
  const retired = items.filter((e) => e.ruling === 'retire');
  return [
    '| kind | item | replaced by | redirect |',
    '| --- | --- | --- | --- |',
    ...retired.map(
      (e) =>
        `| ${e.kind} | ${label(e)} | ${cell(e.replacedBy ?? '')} | ${cell(e.redirect ?? '')} |`,
    ),
  ].join('\n');
}

export function renderRulings(items: readonly InventoryEntry[]): string {
  return [
    '| kind | item | ruling | reason | evidence |',
    '| --- | --- | --- | --- | --- |',
    ...items.map(
      (e) => `| ${e.kind} | ${label(e)} | ${e.ruling} | ${cell(e.reason)} | ${cell(e.evidence)} |`,
    ),
  ].join('\n');
}

export const BLOCKS: Record<string, (items: readonly InventoryEntry[]) => string> = {
  counts: renderCounts,
  cutover: renderCutover,
  rulings: renderRulings,
};

const blockPattern = (name: string) =>
  new RegExp(`(<!-- v1-inventory:${name} -->)\\n([\\s\\S]*?)\\n?(<!-- /v1-inventory:${name} -->)`);

/** The text between a block's markers, or null when the report lacks the block. */
export function readBlock(report: string, name: string): string | null {
  return blockPattern(name).exec(report)?.[2] ?? null;
}

export function writeBlocks(report: string, items: readonly InventoryEntry[]): string {
  let out = report;
  for (const [name, render] of Object.entries(BLOCKS)) {
    out = out.replace(
      blockPattern(name),
      (_m, open, _body, close) => `${open}\n${render(items)}\n${close}`,
    );
  }
  return out;
}
