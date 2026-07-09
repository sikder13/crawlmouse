import { createHash } from 'node:crypto';

/**
 * §7 history-ready: a STABLE, deterministic finding id = hash(kind + canonical target). The same problem
 * on the same page yields the same id across re-audits, so SPEC 06 delta diffing (resolved vs new) works.
 */
export function stableFindingId(kind: string, target: string | null): string {
  return createHash('sha256').update(`${kind}|${target ?? ''}`).digest('hex').slice(0, 16);
}
