/**
 * @crawlmouse/types/v2 — the v2 data contract (CC-11): zod schemas with inferred types, so both the
 * engine and the screens validate against one shape at runtime. See docs/specs/v2/11-type-contract.md.
 *
 * Validating untrusted input: zod 4 drops an own "__proto__" key from a strict object instead of
 * rejecting it, so the parsed output is safe but the schema reports nothing. A route that accepts
 * JSON from outside should reject such keys where it parses the JSON.
 */
export * from './registry.js';
export * from './rules.js';
export * from './enums.js';
export * from './common.js';
export * from './grades.js';
export * from './account.js';
export * from './seat.js';
export * from './site.js';
export * from './check.js';
export * from './page-result.js';
export * from './link-edge.js';
export * from './access-test.js';
export * from './fix.js';
export * from './fix-event.js';
export * from './change.js';
export * from './alert-rule.js';
export * from './report.js';
export * from './crawler-registry.js';
export * from './fixture.js';
export { ENTITIES, type EntityDoc } from './entities.js';
