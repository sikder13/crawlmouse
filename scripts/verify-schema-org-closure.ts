// Drift check for the vendored Schema.org Organization closure.
//
// The vendored list cannot be re-derived inside the test suite — that would need the 1.5 MB
// vocabulary at test time, and CI runs without network. So drift is caught two ways:
//   1. the suite pins COUNT, uniqueness, sort order and membership (legibility.test.ts), which
//      catches a hand-edit or a bad regeneration landing in the repo;
//   2. this script re-derives the closure from the live vocabulary and diffs it, which catches
//      Schema.org itself moving. Run it when a Schema.org release lands, and at any gate.
//
//   nvm use 22 && npx tsx scripts/verify-schema-org-closure.ts
//
// Exits non-zero on any difference and prints both directions.
import { SCHEMA_ORG_ORGANIZATION_TYPES } from '../packages/engine/src/analysis/ai-readiness/schema-org-types.js';

const URL_ = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';
const res = await fetch(URL_);
if (!res.ok) { console.error(`fetch failed: ${res.status}`); process.exit(2); }
const raw = (await res.json()) as { '@graph': Record<string, unknown>[]; schemaVersion?: string };

const short = (i: unknown): string | null => (typeof i === 'string' ? i.split(':').pop()! : null);
const children = new Map<string, string[]>();
for (const n of raw['@graph']) {
  // NO @type filter — 19 MedicalBusiness subclasses are typed `schema:MedicalSpecialty`, and
  // filtering on `rdfs:Class` silently dropped every one of them.
  let parents = n['rdfs:subClassOf'] as unknown;
  if (parents == null) continue;
  if (!Array.isArray(parents)) parents = [parents];
  const me = short(n['@id']);
  for (const p of parents as Record<string, unknown>[]) {
    const pid = short(p?.['@id']);
    if (pid && me) children.set(pid, [...(children.get(pid) ?? []), me]);
  }
}

const seen = new Set<string>();
const stack = ['Organization'];
while (stack.length) {
  const t = stack.pop()!;
  if (seen.has(t)) continue;
  seen.add(t);
  stack.push(...(children.get(t) ?? []));
}
seen.add('WebSite');

const derived = [...seen].sort();
const vendored = [...SCHEMA_ORG_ORGANIZATION_TYPES];
const missing = derived.filter((t) => !vendored.includes(t));
const extra = vendored.filter((t) => !derived.includes(t));

console.log(`schema.org ${raw.schemaVersion ?? 'current'} — derived ${derived.length}, vendored ${vendored.length}`);
if (missing.length) console.log(`MISSING from vendored (${missing.length}): ${missing.join(', ')}`);
if (extra.length) console.log(`EXTRA in vendored (${extra.length}): ${extra.join(', ')}`);
if (!missing.length && !extra.length) { console.log('IDENTICAL — no drift'); process.exit(0); }
process.exit(1);
