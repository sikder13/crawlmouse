import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Whether the tree's migrations add `accounts.internal` (CC-33's does), for the tests and the walk
 * that need the column (CC-38 questions Q1). Read from the files' text, because the gate is decided
 * while tests are collected: a statement `alter table … accounts … add [column] [if not exists]
 * internal`, whatever the file is called. Test-only: no shipped script imports it.
 */

const MIGRATIONS = fileURLToPath(new URL('../../infra/supabase/migrations/', import.meta.url));

export function addsInternalColumn(sql: string): boolean {
  return /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?accounts"?\s[^;]*?\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?internal"?\s/i.test(
    sql,
  );
}

export function migrationsAddInternal(dir: string = MIGRATIONS): boolean {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .some((f) => addsInternalColumn(readFileSync(join(dir, f), 'utf8')));
}
