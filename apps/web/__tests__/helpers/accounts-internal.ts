/**
 * `accounts.internal` is migration 20261115000001 section A's (CC-33 workstream A). Until that section
 * is written, the founder tests apply the file with the column added where section A adds it; with
 * section A present the edit changes nothing.
 */
export const withInternal = (sql: string): string =>
  sql.includes('-- ═══ end §A') && !/add column if not exists internal\b/.test(sql)
    ? sql.replace(
        '-- ═══ end §A',
        'alter table public.accounts add column if not exists internal boolean not null default false;\n-- ═══ end §A',
      )
    : sql;
