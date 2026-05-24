# Crawlmouse v1.0 — Plan 1: Engine + Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working crawl-and-analyze engine that takes a URL and produces a graded internal-linking report. Persisted to Postgres via Supabase. Orchestrated by an Inngest function. Demonstrable via a CLI smoke test against real Shopify / WordPress / Webflow stores. No frontend UI — that's Plan 2.

**Architecture:** TypeScript monorepo (pnpm + Turborepo). `packages/engine` is a pure TS library — no React, no Next.js, no browser APIs. It accepts a URL + options and returns a structured `AuditResult`. The Inngest function in `inngest/audit.ts` calls the engine and persists results to Supabase Postgres via a thin data layer. Smoke tests run the full pipeline against real public sites.

**Tech Stack:** TypeScript 5.5+, pnpm 9+, Turborepo, Vitest, Crawlee 3.x, Cheerio, Sitemapper, Graphology, Supabase (Postgres + pgvector), Inngest 3.x. Reference: design spec at `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md`.

---

## File Structure

Every file this plan creates. Each has one focused responsibility.

```
crawlmouse/
├── .gitignore
├── .env.example
├── .nvmrc
├── pnpm-workspace.yaml
├── package.json
├── turbo.json
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
├── README.md
├── apps/
│   └── web/                         # Placeholder for Plan 2 (just package.json + next.config)
│       └── package.json
├── packages/
│   ├── types/                       # Shared TS types — no logic
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── audit.ts             # AuditOptions, AuditResult, Page, Link, Finding
│   │       └── events.ts            # AuditEvent union
│   └── engine/                      # Pure TS library — the load-bearing piece
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── index.ts             # Public API exports
│           ├── ssrf-guard.ts        # URL/IP validation against SSRF
│           ├── ssrf-guard.test.ts
│           ├── url-canonical.ts     # Canonical URL normalization
│           ├── url-canonical.test.ts
│           ├── robots.ts            # robots.txt fetch + parse
│           ├── robots.test.ts
│           ├── sitemap.ts           # Sitemap discovery + parse + fallback chain
│           ├── sitemap.test.ts
│           ├── cms-detection/
│           │   ├── index.ts
│           │   ├── signatures.ts    # Per-CMS signature definitions
│           │   └── signatures.test.ts
│           ├── crawler.ts           # Crawlee CheerioCrawler wrapper
│           ├── crawler.test.ts
│           ├── extract.ts           # Page + link extraction from HTML
│           ├── extract.test.ts
│           ├── graph.ts             # Graph build + types from Graphology
│           ├── graph.test.ts
│           ├── analysis/
│           │   ├── orphans.ts
│           │   ├── orphans.test.ts
│           │   ├── depth.ts         # BFS click depth
│           │   ├── depth.test.ts
│           │   ├── anchor.ts        # HHI + generic anchor detection
│           │   ├── anchor.test.ts
│           │   ├── pagerank.ts      # PageRank-lite hub authority
│           │   └── pagerank.test.ts
│           ├── cms-adjustments/
│           │   ├── index.ts
│           │   ├── shopify.ts
│           │   ├── wordpress.ts
│           │   └── generic.ts
│           ├── grade.ts             # Grade formula + letter mapping
│           ├── grade.test.ts
│           ├── audit.ts             # Top-level orchestrator: runAudit(url, opts)
│           └── audit.test.ts        # E2E test with mocked HTTP
├── inngest/
│   ├── package.json
│   ├── tsconfig.json
│   ├── client.ts                    # Inngest client init
│   └── audit.ts                     # `crawlmouse.audit` durable function
├── infra/
│   └── supabase/
│       ├── config.toml              # Supabase local CLI config
│       └── migrations/
│           ├── 20260524000001_init_users.sql
│           ├── 20260524000002_audits.sql
│           ├── 20260524000003_indexes.sql
│           └── 20260524000004_rls.sql
├── scripts/
│   ├── smoke-crawl.ts               # CLI: run engine against a real URL, print result
│   └── tsconfig.json
└── docs/
    └── superpowers/
        ├── specs/2026-05-24-crawlmouse-v1.0-design.md   (already exists)
        └── plans/2026-05-24-crawlmouse-v1.0-plan-1-engine-foundation.md   (this file)
```

---

## Tasks

### Task 1: Initial repo scaffolding (pnpm + Turborepo + tsconfig + lint)

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `.eslintrc.cjs`
- Create: `.prettierrc`
- Create: `README.md`

- [ ] **Step 1: Create `.nvmrc`**

```
22
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules
.next
.turbo
.env
.env.local
.env.*.local
dist
build
coverage
*.log
.DS_Store
.vercel
.supabase
.superpowers/
```

- [ ] **Step 3: Create `.env.example`** (lists every secret v1.0 needs)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Inngest
INNGEST_SIGNING_KEY=
INNGEST_EVENT_KEY=

# Stripe (Plan 4)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Resend (Plan 2)
RESEND_API_KEY=

# Cloudflare Turnstile (Plan 2)
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=

# v1.1 LLM
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Observability
POSTHOG_KEY=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
```

- [ ] **Step 4: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "inngest"
  - "scripts"
```

- [ ] **Step 5: Create root `package.json`**

```json
{
  "name": "crawlmouse",
  "private": true,
  "version": "0.0.1",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "smoke": "tsx scripts/smoke-crawl.ts"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "eslint": "^9.10.0",
    "prettier": "^3.3.3",
    "tsx": "^4.19.0",
    "turbo": "^2.1.0",
    "typescript": "^5.5.4"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 6: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 7: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 8: Create `.eslintrc.cjs`** (minimal — strict TS, no React rules here)

```js
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  ignorePatterns: ["dist", "node_modules", ".next", ".turbo"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
  }
};
```

- [ ] **Step 9: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 10: Create `README.md`** (short, points to spec)

```markdown
# Crawlmouse

Free, no-install, share-driven internal-linking grader for any website.

- **Spec:** `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md`
- **Active plan:** `docs/superpowers/plans/2026-05-24-crawlmouse-v1.0-plan-1-engine-foundation.md`

## Quickstart

```bash
pnpm install
pnpm test
pnpm smoke -- --url=https://deathwishcoffee.com
```

See spec for everything else.
```

- [ ] **Step 11: Install dependencies**

Run: `pnpm install`
Expected: clean install, no errors. `node_modules` and `pnpm-lock.yaml` appear.

- [ ] **Step 12: Initialize git, first commit**

```bash
git init
git add .
git commit -m "chore: initial monorepo scaffolding (pnpm + turborepo + tsconfig)"
```

---

### Task 2: Create `packages/types`

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`
- Create: `packages/types/src/audit.ts`
- Create: `packages/types/src/events.ts`

- [ ] **Step 1: Create `packages/types/package.json`**

```json
{
  "name": "@crawlmouse/types",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "import": "./src/index.ts" } },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "echo 'no tests'"
  },
  "devDependencies": {
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Create `packages/types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/types/src/audit.ts`** (all audit-related types — these are the contract every component speaks)

```ts
export type CmsName =
  | 'shopify'
  | 'wordpress'
  | 'webflow'
  | 'wix'
  | 'squarespace'
  | 'framer'
  | 'ghost'
  | 'custom';

export interface AuditOptions {
  url: string;
  pageCap?: number;                    // default: 500 (free), 2000 (pro)
  depthLimit?: number;                 // default: 10
  perHostConcurrency?: number;         // default: 8
  staggerMs?: number;                  // default: 250
  pageTimeoutMs?: number;              // default: 10000
  basicAuth?: { username: string; password: string };   // v1.2 staging
  extraHeaders?: Record<string, string>;                // v1.2 staging
  // Context metadata (v1.2 CI integration; null in v1.0)
  commitSha?: string;
  environment?: string;
  branch?: string;
  deploymentId?: string;
}

export interface Page {
  url: string;
  urlHash: string;                     // sha256 hex
  title?: string;
  statusCode: number;
  depth: number | null;                // null = unreachable
  inDegree: number;
  outDegree: number;
  isOrphan: boolean;
}

export interface Link {
  fromUrl: string;
  toUrl: string;
  anchorText: string;
  isGenericAnchor: boolean;
}

export type FindingCategory =
  | 'orphan'
  | 'near_orphan'
  | 'deep_page'
  | 'unreachable_page'
  | 'over_optimized_anchor'
  | 'generic_anchor_overuse'
  | 'under_linked_important';

export interface Finding {
  category: FindingCategory;
  severity: 'critical' | 'medium' | 'minor';
  pageUrl?: string;
  payload?: Record<string, unknown>;
}

export interface GradeBreakdown {
  orphanRatioScore: number;            // 0..1
  depthScore: number;                  // 0..1
  anchorDiversityScore: number;        // 0..1
  structureScore: number;              // 0..1
}

export interface CmsMetadata {
  themeName?: string;
  isPlus?: boolean;                    // Shopify-specific
  detectedApps?: string[];
  currency?: string;
  locale?: string;
  wpVersion?: string;
  [key: string]: unknown;
}

export interface AuditResult {
  url: string;
  cms: CmsName;
  cmsConfidence: number;               // 0..1
  cmsMetadata: CmsMetadata;
  pages: Page[];
  links: Link[];
  findings: Finding[];
  score: number;                        // 0..100
  grade: string;                        // 'A' | 'A-' | ... | 'F'
  breakdown: GradeBreakdown;
  startedAt: Date;
  completedAt: Date;
}
```

- [ ] **Step 4: Create `packages/types/src/events.ts`** (the event taxonomy that flows from engine → SSE → webhook subscribers)

```ts
export type AuditEvent =
  | { type: 'audit.started'; auditId: string; url: string; timestamp: number }
  | { type: 'audit.progress'; auditId: string; phase: 'sitemap' | 'crawl' | 'analyze' | 'score'; pct: number; timestamp: number }
  | { type: 'page.discovered'; auditId: string; url: string; title?: string; depth?: number; timestamp: number }
  | { type: 'link.found'; auditId: string; from: string; to: string; anchor: string; timestamp: number }
  | { type: 'audit.completed'; auditId: string; grade: string; score: number; timestamp: number }
  | { type: 'audit.failed'; auditId: string; reason: string; timestamp: number }
  | { type: 'grade.changed'; auditId: string; previousGrade: string; newGrade: string; timestamp: number }
  | { type: 'suggestions.ready'; auditId: string; count: number; timestamp: number };

export type AuditEventType = AuditEvent['type'];
```

- [ ] **Step 5: Create `packages/types/src/index.ts`** (barrel export)

```ts
export * from './audit.js';
export * from './events.js';
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @crawlmouse/types typecheck`
Expected: no errors.

```bash
git add packages/types
git commit -m "feat(types): shared audit types and event taxonomy"
```

---

### Task 3: Create `packages/engine` skeleton + Vitest config

**Files:**
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/vitest.config.ts`
- Create: `packages/engine/src/index.ts`

- [ ] **Step 1: Create `packages/engine/package.json`**

```json
{
  "name": "@crawlmouse/engine",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "import": "./src/index.ts" } },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@crawlmouse/types": "workspace:*",
    "cheerio": "^1.0.0",
    "crawlee": "^3.11.0",
    "graphology": "^0.25.4",
    "graphology-pagerank": "^1.1.0",
    "sitemapper": "^3.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "msw": "^2.4.0"
  }
}
```

- [ ] **Step 2: Create `packages/engine/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "paths": { "@crawlmouse/types": ["../types/src/index.ts"] }
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/engine/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    coverage: { provider: 'v8', reporter: ['text', 'lcov'], include: ['src/**/*.ts'] },
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `packages/engine/src/index.ts`** (placeholder barrel — will fill as modules are added)

```ts
// Public API of the engine. Populated incrementally as modules are added.
export {};
```

- [ ] **Step 5: Install deps**

Run: `pnpm install`
Expected: `crawlee`, `cheerio`, `graphology`, `sitemapper`, `vitest` etc. resolved.

- [ ] **Step 6: Verify Vitest runs (no tests yet)**

Run: `pnpm --filter @crawlmouse/engine test`
Expected: "No test files found" (this is OK — zero-test exit code is 0 by default in Vitest 2.x; if Vitest exits non-zero, add `passWithNoTests: true` to vitest.config.ts).

- [ ] **Step 7: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): package skeleton with vitest"
```

---

### Task 4: SSRF guard module (the most security-critical piece of v1.0)

**Files:**
- Create: `packages/engine/src/ssrf-guard.ts`
- Create: `packages/engine/src/ssrf-guard.test.ts`

This module is referenced by every crawler entry point. Failure to block private IPs = security bug that exposes internal infrastructure.

- [ ] **Step 1: Write failing test cases**

`packages/engine/src/ssrf-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPrivateOrReservedIp, validateUrlOrThrow } from './ssrf-guard.js';

describe('isPrivateOrReservedIp', () => {
  it.each([
    ['127.0.0.1', true, 'loopback'],
    ['10.0.0.1', true, 'rfc1918 10/8'],
    ['172.16.0.1', true, 'rfc1918 172.16/12'],
    ['172.31.255.255', true, 'rfc1918 172.16/12 upper'],
    ['192.168.0.1', true, 'rfc1918 192.168/16'],
    ['169.254.169.254', true, 'cloud metadata / link-local'],
    ['0.0.0.0', true, 'unspecified'],
    ['::1', true, 'ipv6 loopback'],
    ['fc00::1', true, 'ipv6 ULA'],
    ['fe80::1', true, 'ipv6 link-local'],
    ['8.8.8.8', false, 'public dns'],
    ['1.1.1.1', false, 'public cf'],
    ['2606:4700:4700::1111', false, 'public ipv6'],
  ])('IP %s is private/reserved=%s (%s)', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe('validateUrlOrThrow', () => {
  it('accepts public https URLs', async () => {
    await expect(validateUrlOrThrow('https://example.com')).resolves.toBeInstanceOf(URL);
  });

  it('rejects non-http schemes', async () => {
    await expect(validateUrlOrThrow('file:///etc/passwd')).rejects.toThrow(/scheme/i);
    await expect(validateUrlOrThrow('gopher://example.com')).rejects.toThrow(/scheme/i);
    await expect(validateUrlOrThrow('javascript:alert(1)')).rejects.toThrow(/scheme/i);
  });

  it('rejects URLs that resolve to private IPs', async () => {
    // Provide a resolver that always returns a private IP.
    await expect(
      validateUrlOrThrow('https://internal.example', {
        resolver: async () => ['10.0.0.1'],
      }),
    ).rejects.toThrow(/private/i);
  });

  it('accepts URLs that resolve to public IPs', async () => {
    const result = await validateUrlOrThrow('https://example.com', {
      resolver: async () => ['8.8.8.8'],
    });
    expect(result).toBeInstanceOf(URL);
  });

  it('rejects malformed URLs', async () => {
    await expect(validateUrlOrThrow('not a url')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crawlmouse/engine test ssrf-guard`
Expected: FAIL with "Cannot find module './ssrf-guard.js'" or similar.

- [ ] **Step 3: Implement `ssrf-guard.ts`**

```ts
import { promises as dns } from 'node:dns';
import net from 'node:net';

export type DnsResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: DnsResolver = async (hostname) => {
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.map((r) => r.address);
  } catch {
    return [];
  }
};

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Returns true for IPs that must not be reached from server-side fetches:
 * - RFC 1918 private (10/8, 172.16/12, 192.168/16)
 * - Loopback (127/8, ::1)
 * - Link-local (169.254/16, fe80::/10) — includes cloud metadata 169.254.169.254
 * - Unspecified (0.0.0.0, ::)
 * - IPv6 ULA (fc00::/7)
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return true; // not a valid IP — treat as reserved

  if (family === 4) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets as [number, number, number, number];
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // 10/8
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;        // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true;        // 192.168/16
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80')) return true;        // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  return false;
}

export interface ValidateUrlOptions {
  resolver?: DnsResolver;
}

/**
 * Parses, validates scheme, resolves DNS, blocks private IPs.
 * Throws Error with a human-readable message if anything fails.
 */
export async function validateUrlOrThrow(
  input: string,
  opts: ValidateUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(`Disallowed URL scheme: ${url.protocol}`);
  }

  const resolver = opts.resolver ?? defaultResolver;
  const addresses = await resolver(url.hostname);
  if (addresses.length === 0) {
    throw new Error(`DNS resolution failed for ${url.hostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr)) {
      throw new Error(`URL resolves to private or reserved IP (${addr}): ${url.toString()}`);
    }
  }

  return url;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @crawlmouse/engine test ssrf-guard`
Expected: all tests pass (green).

- [ ] **Step 5: Add to `packages/engine/src/index.ts`**

```ts
export { validateUrlOrThrow, isPrivateOrReservedIp } from './ssrf-guard.js';
export type { DnsResolver, ValidateUrlOptions } from './ssrf-guard.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/ssrf-guard.ts packages/engine/src/ssrf-guard.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): SSRF guard with DNS-resolved private IP blocking"
```

---

### Task 5: URL canonicalization

**Files:**
- Create: `packages/engine/src/url-canonical.ts`
- Create: `packages/engine/src/url-canonical.test.ts`

Two URLs that point to the same resource should hash to the same value (for orphan detection, dedup, benchmarking).

- [ ] **Step 1: Write failing tests**

`packages/engine/src/url-canonical.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canonicalizeUrl, hashUrl } from './url-canonical.js';

describe('canonicalizeUrl', () => {
  it.each([
    ['HTTPS://Example.COM/Path/', 'https://example.com/Path'],
    ['https://example.com:443/path', 'https://example.com/path'],
    ['http://example.com:80/path', 'http://example.com/path'],
    ['https://example.com/path?b=2&a=1', 'https://example.com/path?a=1&b=2'],
    ['https://example.com/path#fragment', 'https://example.com/path'],
    ['https://example.com//path//to///page', 'https://example.com/path/to/page'],
    ['https://example.com/', 'https://example.com'],
    ['https://example.com', 'https://example.com'],
  ])('canonicalizes %s -> %s', (input, expected) => {
    expect(canonicalizeUrl(input)).toBe(expected);
  });
});

describe('hashUrl', () => {
  it('is stable across canonical equivalents', () => {
    expect(hashUrl('HTTPS://Example.COM/path/')).toBe(hashUrl('https://example.com/path'));
  });

  it('differs for different URLs', () => {
    expect(hashUrl('https://example.com/a')).not.toBe(hashUrl('https://example.com/b'));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test url-canonical`
Expected: FAIL ("Cannot find module ...").

- [ ] **Step 3: Implement `url-canonical.ts`**

```ts
import { createHash } from 'node:crypto';

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  if (DEFAULT_PORTS[url.protocol] === url.port) url.port = '';

  // Sort query params alphabetically
  if (url.search) {
    const params = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    for (const [k, v] of params) url.searchParams.append(k, v);
  }

  // Collapse multiple slashes in path (preserve scheme://)
  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  // Strip trailing slash (except root)
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  url.pathname = pathname;

  // Construct manually to drop trailing slash on origin-only URLs
  const out = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  return out;
}

export function hashUrl(input: string): string {
  return createHash('sha256').update(canonicalizeUrl(input)).digest('hex');
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test url-canonical`
Expected: green.

- [ ] **Step 5: Export from index**

Append to `packages/engine/src/index.ts`:

```ts
export { canonicalizeUrl, hashUrl } from './url-canonical.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/url-canonical.ts packages/engine/src/url-canonical.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): URL canonicalization and stable hashing"
```

---

### Task 6: Robots.txt fetcher + parser

**Files:**
- Create: `packages/engine/src/robots.ts`
- Create: `packages/engine/src/robots.test.ts`

We need to (a) discover sitemap URLs from robots.txt `Sitemap:` directives, (b) respect `Disallow:` rules during crawl.

- [ ] **Step 1: Write failing tests**

`packages/engine/src/robots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseRobotsTxt, isAllowedByRobots } from './robots.js';

const sample = `
User-agent: *
Disallow: /admin/
Disallow: /private
Allow: /private/public

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap_products.xml
`;

describe('parseRobotsTxt', () => {
  it('extracts sitemap URLs', () => {
    const r = parseRobotsTxt(sample);
    expect(r.sitemaps).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap_products.xml',
    ]);
  });

  it('extracts disallow + allow rules for wildcard UA', () => {
    const r = parseRobotsTxt(sample);
    expect(r.rules['*']?.disallow).toEqual(['/admin/', '/private']);
    expect(r.rules['*']?.allow).toEqual(['/private/public']);
  });
});

describe('isAllowedByRobots', () => {
  const r = parseRobotsTxt(sample);

  it.each([
    ['/products/x', true],
    ['/admin/users', false],
    ['/private', false],
    ['/private/public', true],
  ])('path %s allowed=%s', (path, expected) => {
    expect(isAllowedByRobots(r, 'CrawlmouseBot', path)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test robots`
Expected: FAIL.

- [ ] **Step 3: Implement `robots.ts`**

```ts
export interface RobotsRules {
  disallow: string[];
  allow: string[];
}

export interface ParsedRobots {
  sitemaps: string[];
  rules: Record<string, RobotsRules>;       // key = lowercased UA, '*' for wildcard
}

export function parseRobotsTxt(text: string): ParsedRobots {
  const sitemaps: string[] = [];
  const rules: Record<string, RobotsRules> = {};
  let currentUas: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    const directive = m[1]!.toLowerCase();
    const value = m[2]!.trim();

    if (directive === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (directive === 'user-agent') {
      currentUas = [value.toLowerCase()];
    } else if (directive === 'disallow' || directive === 'allow') {
      for (const ua of currentUas) {
        rules[ua] ??= { disallow: [], allow: [] };
        if (value) rules[ua][directive].push(value);
      }
    }
  }

  return { sitemaps, rules };
}

export function isAllowedByRobots(robots: ParsedRobots, userAgent: string, path: string): boolean {
  const uaKey = userAgent.toLowerCase();
  const r = robots.rules[uaKey] ?? robots.rules['*'];
  if (!r) return true;

  // Most specific match wins (longest prefix). Allow > Disallow at equal length.
  let bestMatch: { isAllow: boolean; len: number } | null = null;
  for (const rule of r.disallow) if (path.startsWith(rule)) {
    if (!bestMatch || rule.length > bestMatch.len) bestMatch = { isAllow: false, len: rule.length };
  }
  for (const rule of r.allow) if (path.startsWith(rule)) {
    if (!bestMatch || rule.length >= bestMatch.len) bestMatch = { isAllow: true, len: rule.length };
  }

  return bestMatch ? bestMatch.isAllow : true;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test robots`
Expected: green.

- [ ] **Step 5: Export from index, commit**

Append to `packages/engine/src/index.ts`:

```ts
export { parseRobotsTxt, isAllowedByRobots } from './robots.js';
export type { ParsedRobots, RobotsRules } from './robots.js';
```

```bash
git add packages/engine/src/robots.ts packages/engine/src/robots.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): robots.txt parser with sitemap extraction + path allow/disallow"
```

---

### Task 7: Sitemap discovery + parsing with fallback chain

**Files:**
- Create: `packages/engine/src/sitemap.ts`
- Create: `packages/engine/src/sitemap.test.ts`

The crawler needs URLs to crawl. Discovery order: robots.txt → `/sitemap.xml` → common paths → fallback to homepage HTML crawl.

- [ ] **Step 1: Write failing tests**

`packages/engine/src/sitemap.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { discoverSitemaps, parseSitemapUrls } from './sitemap.js';

describe('discoverSitemaps', () => {
  it('returns sitemaps from robots.txt when present', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { status: 200, body: 'Sitemap: https://example.com/sitemap.xml\n' };
      }
      return { status: 404, body: '' };
    });
    const out = await discoverSitemaps('https://example.com', { fetcher });
    expect(out.sitemapUrls).toEqual(['https://example.com/sitemap.xml']);
    expect(out.source).toBe('robots');
  });

  it('falls back to common paths if robots.txt has no sitemaps', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/sitemap.xml')) return { status: 200, body: '<urlset></urlset>' };
      return { status: 404, body: '' };
    });
    const out = await discoverSitemaps('https://example.com', { fetcher });
    expect(out.sitemapUrls).toContain('https://example.com/sitemap.xml');
    expect(out.source).toBe('common_path');
  });

  it('returns empty + source=none when nothing exists', async () => {
    const fetcher = vi.fn(async () => ({ status: 404, body: '' }));
    const out = await discoverSitemaps('https://example.com', { fetcher });
    expect(out.sitemapUrls).toEqual([]);
    expect(out.source).toBe('none');
  });
});

describe('parseSitemapUrls', () => {
  it('parses a simple urlset', async () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/a</loc></url>
        <url><loc>https://example.com/b</loc></url>
      </urlset>`;
    const urls = await parseSitemapUrls('https://example.com/sitemap.xml', {
      fetcher: async () => ({ status: 200, body: xml }),
    });
    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('follows sitemap index to children', async () => {
    const index = `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/products.xml</loc></sitemap>
      </sitemapindex>`;
    const child = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/p1</loc></url>
      </urlset>`;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('products.xml')) return { status: 200, body: child };
      return { status: 200, body: index };
    });
    const urls = await parseSitemapUrls('https://example.com/sitemap.xml', { fetcher });
    expect(urls).toEqual(['https://example.com/p1']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test sitemap`
Expected: FAIL.

- [ ] **Step 3: Implement `sitemap.ts`**

```ts
import * as cheerio from 'cheerio';
import { parseRobotsTxt } from './robots.js';

export interface FetchedResource { status: number; body: string }
export type Fetcher = (url: string) => Promise<FetchedResource>;

export interface DiscoverResult {
  sitemapUrls: string[];
  source: 'robots' | 'common_path' | 'none';
}

export interface DiscoverOptions { fetcher: Fetcher }

const COMMON_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap1.xml',
  '/sitemap-index.xml',
];

export async function discoverSitemaps(
  origin: string,
  opts: DiscoverOptions,
): Promise<DiscoverResult> {
  const robotsRes = await opts.fetcher(`${origin}/robots.txt`).catch(() => null);
  if (robotsRes && robotsRes.status === 200 && robotsRes.body) {
    const parsed = parseRobotsTxt(robotsRes.body);
    if (parsed.sitemaps.length > 0) {
      return { sitemapUrls: parsed.sitemaps, source: 'robots' };
    }
  }

  for (const path of COMMON_SITEMAP_PATHS) {
    const url = `${origin}${path}`;
    const res = await opts.fetcher(url).catch(() => null);
    if (res && res.status === 200 && res.body) {
      return { sitemapUrls: [url], source: 'common_path' };
    }
  }

  return { sitemapUrls: [], source: 'none' };
}

export interface ParseOptions { fetcher: Fetcher; depthLimit?: number }

export async function parseSitemapUrls(
  sitemapUrl: string,
  opts: ParseOptions,
  depth = 0,
): Promise<string[]> {
  if (depth > (opts.depthLimit ?? 3)) return [];
  const res = await opts.fetcher(sitemapUrl);
  if (res.status !== 200 || !res.body) return [];

  const $ = cheerio.load(res.body, { xmlMode: true });

  // sitemap index?
  const indexLocs = $('sitemapindex > sitemap > loc').map((_, el) => $(el).text().trim()).get();
  if (indexLocs.length > 0) {
    const all: string[] = [];
    for (const child of indexLocs) {
      const childUrls = await parseSitemapUrls(child, opts, depth + 1);
      all.push(...childUrls);
    }
    return all;
  }

  // urlset
  return $('urlset > url > loc').map((_, el) => $(el).text().trim()).get();
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test sitemap`
Expected: green.

- [ ] **Step 5: Export, commit**

Append to `packages/engine/src/index.ts`:

```ts
export { discoverSitemaps, parseSitemapUrls } from './sitemap.js';
export type { Fetcher, FetchedResource, DiscoverResult } from './sitemap.js';
```

```bash
git add packages/engine/src/sitemap.ts packages/engine/src/sitemap.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): sitemap discovery + parsing with index-follow"
```

---

### Task 8: CMS detection signatures

**Files:**
- Create: `packages/engine/src/cms-detection/signatures.ts`
- Create: `packages/engine/src/cms-detection/signatures.test.ts`
- Create: `packages/engine/src/cms-detection/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/engine/src/cms-detection/signatures.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectCms } from './index.js';

describe('detectCms', () => {
  it('detects Shopify from CDN reference + script tag', () => {
    const html = `<html><head><script src="https://cdn.shopify.com/s/x.js"></script></head></html>`;
    const result = detectCms(html, {});
    expect(result.cms).toBe('shopify');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('detects WordPress from wp-content', () => {
    const html = `<html><head><link href="/wp-content/themes/x/style.css"></head></html>`;
    expect(detectCms(html, {}).cms).toBe('wordpress');
  });

  it('detects Webflow from data-wf-page', () => {
    const html = `<html data-wf-page="abc"><body></body></html>`;
    expect(detectCms(html, {}).cms).toBe('webflow');
  });

  it('detects Wix from wixstatic', () => {
    const html = `<html><body><img src="https://static.wixstatic.com/x.png"></body></html>`;
    expect(detectCms(html, {}).cms).toBe('wix');
  });

  it('falls back to custom when no signature exceeds threshold', () => {
    const html = `<html><head><title>Plain</title></head><body>Hello.</body></html>`;
    const result = detectCms(html, {});
    expect(result.cms).toBe('custom');
    expect(result.confidence).toBeLessThan(0.6);
  });

  it('returns higher confidence with multiple matches', () => {
    const single = detectCms(`<script src="cdn.shopify.com"></script>`, {}).confidence;
    const multi = detectCms(
      `<script src="cdn.shopify.com"></script><script>Shopify.theme={}</script><div class="shopify-section"></div>`,
      {},
    ).confidence;
    expect(multi).toBeGreaterThan(single);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test cms-detection`
Expected: FAIL.

- [ ] **Step 3: Create `signatures.ts`**

```ts
import type { CmsName } from '@crawlmouse/types';

export interface Signature {
  cms: CmsName;
  htmlPatterns?: RegExp[];
  headerPatterns?: { name: string; pattern: RegExp | 'present' }[];
}

export const SIGNATURES: Signature[] = [
  {
    cms: 'shopify',
    htmlPatterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /shopify-section/i],
    headerPatterns: [
      { name: 'x-shopid', pattern: 'present' },
      { name: 'x-shopify-stage', pattern: 'present' },
    ],
  },
  {
    cms: 'wordpress',
    htmlPatterns: [/wp-content/i, /<meta\s+name=["']generator["']\s+content=["']WordPress/i, /wp-json/i],
  },
  {
    cms: 'webflow',
    htmlPatterns: [/data-wf-page/i, /webflow\.com/i, /wf-form/i],
    headerPatterns: [{ name: 'x-powered-by', pattern: /webflow/i }],
  },
  {
    cms: 'wix',
    htmlPatterns: [/static\.wixstatic\.com/i, /window\.wixBiSession/i],
    headerPatterns: [{ name: 'x-wix-published-version', pattern: 'present' }],
  },
  {
    cms: 'squarespace',
    htmlPatterns: [/static1\.squarespace\.com/i, /Static\.SQUARESPACE_CONTEXT/i],
  },
  {
    cms: 'framer',
    htmlPatterns: [/framer\.com/i, /__framer__/i],
    headerPatterns: [{ name: 'x-framer-site-id', pattern: 'present' }],
  },
  {
    cms: 'ghost',
    htmlPatterns: [/<meta\s+name=["']generator["']\s+content=["']Ghost/i],
  },
];
```

- [ ] **Step 4: Create `index.ts` (detector entry point)**

```ts
import type { CmsName } from '@crawlmouse/types';
import { SIGNATURES } from './signatures.js';

export interface DetectionResult {
  cms: CmsName;
  confidence: number;       // 0..1
}

export function detectCms(html: string, headers: Record<string, string | undefined>): DetectionResult {
  let bestCms: CmsName = 'custom';
  let bestScore = 0;

  for (const sig of SIGNATURES) {
    const htmlMatches = sig.htmlPatterns?.filter((p) => p.test(html)).length ?? 0;
    const headerMatches =
      sig.headerPatterns?.filter((h) => {
        const v = headers[h.name.toLowerCase()];
        if (!v) return false;
        return h.pattern === 'present' ? true : h.pattern.test(v);
      }).length ?? 0;

    const totalSignals = (sig.htmlPatterns?.length ?? 0) + (sig.headerPatterns?.length ?? 0);
    if (totalSignals === 0) continue;
    const matched = htmlMatches + headerMatches;
    const score = matched / totalSignals;
    if (score > bestScore) {
      bestScore = score;
      if (score > 0) bestCms = sig.cms;
    }
  }

  return { cms: bestScore >= 0.34 ? bestCms : 'custom', confidence: bestScore };
}
```

Note the threshold: `>= 0.34` means at least one signal of a CMS with three signals triggers detection. The wider test for `> 0.6` confidence still applies for "we're really sure" callers — see `audits.cmsConfidence` in §4 of the spec.

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test cms-detection`
Expected: green.

- [ ] **Step 6: Export from index, commit**

Append to `packages/engine/src/index.ts`:

```ts
export { detectCms, SIGNATURES } from './cms-detection/index.js';
export type { DetectionResult } from './cms-detection/index.js';
```

```bash
git add packages/engine/src/cms-detection packages/engine/src/index.ts
git commit -m "feat(engine): CMS detection for 7 platforms via signature scoring"
```

---

### Task 9: Page + link extraction from HTML

**Files:**
- Create: `packages/engine/src/extract.ts`
- Create: `packages/engine/src/extract.test.ts`

Given page HTML, extract title + internal links + anchor text. Internal = same eTLD+1.

- [ ] **Step 1: Write failing tests**

`packages/engine/src/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractPage } from './extract.js';

describe('extractPage', () => {
  it('extracts title and internal links', () => {
    const html = `
      <html><head><title>Home</title></head>
      <body>
        <a href="/about">About</a>
        <a href="https://example.com/products">Products</a>
        <a href="https://other.com/x">External</a>
        <a href="/contact" class="cta">Contact us</a>
      </body></html>`;
    const result = extractPage(html, 'https://example.com/');
    expect(result.title).toBe('Home');
    expect(result.links.map((l) => l.toUrl)).toEqual([
      'https://example.com/about',
      'https://example.com/products',
      'https://example.com/contact',
    ]);
    expect(result.links[0]!.anchorText).toBe('About');
  });

  it('skips empty hrefs, fragments-only, javascript:, mailto:', () => {
    const html = `<a href="#top">x</a><a href="javascript:void(0)">y</a><a href="mailto:a@b.com">z</a><a href="">empty</a>`;
    const result = extractPage(html, 'https://example.com/');
    expect(result.links).toEqual([]);
  });

  it('marks generic anchors', () => {
    const html = `<a href="/a">Click here</a><a href="/b">Real product page</a>`;
    const result = extractPage(html, 'https://example.com/');
    expect(result.links[0]!.isGenericAnchor).toBe(true);
    expect(result.links[1]!.isGenericAnchor).toBe(false);
  });

  it('handles relative URLs from non-root pages', () => {
    const html = `<a href="../sibling">x</a><a href="child">y</a>`;
    const result = extractPage(html, 'https://example.com/blog/post');
    expect(result.links.map((l) => l.toUrl)).toEqual([
      'https://example.com/sibling',
      'https://example.com/blog/child',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test extract`
Expected: FAIL.

- [ ] **Step 3: Implement `extract.ts`**

```ts
import * as cheerio from 'cheerio';
import { canonicalizeUrl } from './url-canonical.js';

const GENERIC_ANCHOR_PATTERNS = [
  /^(click here|read more|learn more|more info|here|this|link|go|continue)\.?$/i,
  /^(see more|find out more|get started|view more)$/i,
];

export interface ExtractedLink {
  toUrl: string;
  anchorText: string;
  isGenericAnchor: boolean;
}

export interface ExtractedPage {
  title?: string;
  links: ExtractedLink[];
}

function sameRegistrableDomain(a: URL, b: URL): boolean {
  // Lightweight: compare hostnames after stripping `www.`
  const norm = (h: string) => h.replace(/^www\./, '').toLowerCase();
  return norm(a.hostname) === norm(b.hostname);
}

function isGeneric(anchor: string): boolean {
  const trimmed = anchor.trim();
  return GENERIC_ANCHOR_PATTERNS.some((p) => p.test(trimmed));
}

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || undefined;

  const baseUrlObj = new URL(baseUrl);
  const links: ExtractedLink[] = [];

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }
    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    if (!sameRegistrableDomain(resolved, baseUrlObj)) return;

    const anchorText = $(el).text().trim().replace(/\s+/g, ' ');
    links.push({
      toUrl: canonicalizeUrl(resolved.toString()),
      anchorText,
      isGenericAnchor: isGeneric(anchorText),
    });
  });

  return { title, links };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test extract`
Expected: green.

- [ ] **Step 5: Export, commit**

Append to `packages/engine/src/index.ts`:

```ts
export { extractPage } from './extract.js';
export type { ExtractedPage, ExtractedLink } from './extract.js';
```

```bash
git add packages/engine/src/extract.ts packages/engine/src/extract.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): HTML page + internal link extraction"
```

---

### Task 10: Crawlee CheerioCrawler wrapper

**Files:**
- Create: `packages/engine/src/crawler.ts`
- Create: `packages/engine/src/crawler.test.ts`

Wrap Crawlee's `CheerioCrawler` with our SSRF guard + politeness defaults + result collection.

- [ ] **Step 1: Write failing test (uses a tiny inline HTTP server via Node `http`)**

`packages/engine/src/crawler.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/' || req.url === '') {
      res.end(`<html><head><title>Home</title></head><body><a href="/a">A</a><a href="/b">B</a></body></html>`);
    } else if (req.url === '/a') {
      res.end(`<html><head><title>A</title></head><body><a href="/">Home</a></body></html>`);
    } else if (req.url === '/b') {
      res.end(`<html><head><title>B</title></head><body></body></html>`);
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('runCrawl', () => {
  it('crawls a small site and returns pages + links', async () => {
    // For this test we bypass SSRF guard by injecting an allow-loopback resolver
    const result = await runCrawl({
      startUrls: [baseUrl],
      pageCap: 10,
      perHostConcurrency: 2,
      staggerMs: 50,
      pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true,
    });
    expect(result.pages.length).toBe(3);
    expect(result.links.length).toBeGreaterThan(0);
    const titles = result.pages.map((p) => p.title).sort();
    expect(titles).toEqual(['A', 'B', 'Home']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test crawler`
Expected: FAIL.

- [ ] **Step 3: Implement `crawler.ts`**

```ts
import { CheerioCrawler, Configuration, log, LogLevel } from 'crawlee';
import { validateUrlOrThrow } from './ssrf-guard.js';
import { canonicalizeUrl, hashUrl } from './url-canonical.js';
import { extractPage } from './extract.js';

log.setLevel(LogLevel.OFF);

export interface CrawlInput {
  startUrls: string[];
  pageCap: number;
  perHostConcurrency: number;
  staggerMs: number;
  pageTimeoutMs: number;
  userAgent?: string;
  basicAuth?: { username: string; password: string };
  extraHeaders?: Record<string, string>;
  allowPrivateIpsForTesting?: boolean;
}

export interface CrawledPage {
  url: string;
  urlHash: string;
  title?: string;
  statusCode: number;
}

export interface CrawledLink {
  fromUrl: string;
  toUrl: string;
  anchorText: string;
  isGenericAnchor: boolean;
}

export interface CrawlOutput {
  pages: CrawledPage[];
  links: CrawledLink[];
}

const DEFAULT_UA = 'CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)';

export async function runCrawl(input: CrawlInput): Promise<CrawlOutput> {
  const pages = new Map<string, CrawledPage>();
  const links: CrawledLink[] = [];

  // Pre-validate every start URL (unless test mode)
  if (!input.allowPrivateIpsForTesting) {
    for (const u of input.startUrls) await validateUrlOrThrow(u);
  }

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: input.pageCap,
    maxConcurrency: input.perHostConcurrency,
    requestHandlerTimeoutSecs: Math.ceil(input.pageTimeoutMs / 1000),
    additionalMimeTypes: ['text/html'],
    preNavigationHooks: [
      async (_ctx, gotOptions) => {
        gotOptions.headers = {
          'User-Agent': input.userAgent ?? DEFAULT_UA,
          ...(input.extraHeaders ?? {}),
        };
        if (input.basicAuth) {
          const token = Buffer.from(`${input.basicAuth.username}:${input.basicAuth.password}`).toString('base64');
          gotOptions.headers['Authorization'] = `Basic ${token}`;
        }
        // Politeness stagger
        await new Promise((r) => setTimeout(r, input.staggerMs));
      },
    ],
    async requestHandler({ request, $, response, enqueueLinks }) {
      const url = canonicalizeUrl(request.loadedUrl ?? request.url);
      const html = $.html();
      const extracted = extractPage(html, url);
      const statusCode = response.statusCode;

      pages.set(url, {
        url,
        urlHash: hashUrl(url),
        title: extracted.title,
        statusCode,
      });

      for (const link of extracted.links) {
        links.push({ fromUrl: url, toUrl: link.toUrl, anchorText: link.anchorText, isGenericAnchor: link.isGenericAnchor });
      }

      // Enqueue same-origin links
      const origin = new URL(url).origin;
      const sameOrigin = extracted.links.filter((l) => l.toUrl.startsWith(origin)).map((l) => l.toUrl);
      await enqueueLinks({ urls: sameOrigin, strategy: 'same-origin' });
    },
    failedRequestHandler({ request }) {
      // Record as 0-status page so it appears in the graph as unreachable
      const url = canonicalizeUrl(request.url);
      if (!pages.has(url)) {
        pages.set(url, { url, urlHash: hashUrl(url), statusCode: 0 });
      }
    },
  }, new Configuration({ persistStorage: false, purgeOnStart: true }));

  await crawler.run(input.startUrls);

  return { pages: Array.from(pages.values()), links };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test crawler`
Expected: green.

- [ ] **Step 5: Export, commit**

Append to `packages/engine/src/index.ts`:

```ts
export { runCrawl } from './crawler.js';
export type { CrawlInput, CrawlOutput, CrawledPage, CrawledLink } from './crawler.js';
```

```bash
git add packages/engine/src/crawler.ts packages/engine/src/crawler.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): Crawlee + Cheerio crawler with SSRF guard and politeness"
```

---

### Task 11: Graph builder (Graphology)

**Files:**
- Create: `packages/engine/src/graph.ts`
- Create: `packages/engine/src/graph.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/engine/src/graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph.js';

const pages = [
  { url: 'https://x.com/', urlHash: 'h-home', statusCode: 200 },
  { url: 'https://x.com/a', urlHash: 'h-a', statusCode: 200 },
  { url: 'https://x.com/b', urlHash: 'h-b', statusCode: 200 },
  { url: 'https://x.com/c', urlHash: 'h-c', statusCode: 200 },   // orphan candidate
];
const links = [
  { fromUrl: 'https://x.com/', toUrl: 'https://x.com/a', anchorText: 'A', isGenericAnchor: false },
  { fromUrl: 'https://x.com/', toUrl: 'https://x.com/b', anchorText: 'B', isGenericAnchor: false },
  { fromUrl: 'https://x.com/a', toUrl: 'https://x.com/b', anchorText: 'B again', isGenericAnchor: false },
];

describe('buildGraph', () => {
  it('creates nodes for all pages and edges for all links to known pages', () => {
    const g = buildGraph(pages, links);
    expect(g.order).toBe(4);
    expect(g.size).toBe(3);
  });

  it('reports in/out degrees correctly', () => {
    const g = buildGraph(pages, links);
    expect(g.inDegree('https://x.com/b')).toBe(2);
    expect(g.outDegree('https://x.com/a')).toBe(1);
    expect(g.inDegree('https://x.com/c')).toBe(0);
  });

  it('drops edges pointing to unknown pages', () => {
    const linksWithGhost = [...links, { fromUrl: 'https://x.com/', toUrl: 'https://x.com/ghost', anchorText: '?', isGenericAnchor: false }];
    const g = buildGraph(pages, linksWithGhost);
    expect(g.size).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test graph`
Expected: FAIL.

- [ ] **Step 3: Implement `graph.ts`**

```ts
import Graph from 'graphology';
import type { CrawledPage, CrawledLink } from './crawler.js';

export interface PageNodeAttrs {
  urlHash: string;
  title?: string;
  statusCode: number;
}

export interface LinkEdgeAttrs {
  anchorText: string;
  isGenericAnchor: boolean;
}

export type SiteGraph = Graph<PageNodeAttrs, LinkEdgeAttrs>;

export function buildGraph(pages: CrawledPage[], links: CrawledLink[]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const p of pages) {
    g.addNode(p.url, { urlHash: p.urlHash, title: p.title, statusCode: p.statusCode });
  }
  for (const l of links) {
    if (!g.hasNode(l.fromUrl) || !g.hasNode(l.toUrl)) continue;
    if (l.fromUrl === l.toUrl) continue;
    if (g.hasEdge(l.fromUrl, l.toUrl)) continue;   // dedupe; we don't model parallel anchors as separate edges
    g.addDirectedEdge(l.fromUrl, l.toUrl, { anchorText: l.anchorText, isGenericAnchor: l.isGenericAnchor });
  }
  return g;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test graph`
Expected: green.

- [ ] **Step 5: Export, commit**

Append to `packages/engine/src/index.ts`:

```ts
export { buildGraph } from './graph.js';
export type { SiteGraph, PageNodeAttrs, LinkEdgeAttrs } from './graph.js';
```

```bash
git add packages/engine/src/graph.ts packages/engine/src/graph.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): graph builder using Graphology"
```

---

### Task 12: Orphan detection

**Files:**
- Create: `packages/engine/src/analysis/orphans.ts`
- Create: `packages/engine/src/analysis/orphans.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/engine/src/analysis/orphans.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { detectOrphans } from './orphans.js';
import type { SiteGraph } from '../graph.js';

function makeGraph(nodes: string[], edges: [string, string][]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const n of nodes) g.addNode(n, { urlHash: '', statusCode: 200 });
  for (const [a, b] of edges) g.addDirectedEdge(a, b, { anchorText: '', isGenericAnchor: false });
  return g;
}

describe('detectOrphans', () => {
  it('classifies pages with in-degree 0 as orphans (except homepage)', () => {
    const g = makeGraph(
      ['https://x.com/', 'https://x.com/a', 'https://x.com/b', 'https://x.com/orphan'],
      [['https://x.com/', 'https://x.com/a'], ['https://x.com/a', 'https://x.com/b']],
    );
    const r = detectOrphans(g, 'https://x.com/');
    expect(r.orphans).toEqual(['https://x.com/orphan']);
    expect(r.orphanRatio).toBeCloseTo(1 / 4);
  });

  it('classifies pages with in-degree 1 or 2 as near-orphans', () => {
    const g = makeGraph(
      ['https://x.com/', 'https://x.com/a', 'https://x.com/b'],
      [['https://x.com/', 'https://x.com/a']],
    );
    const r = detectOrphans(g, 'https://x.com/');
    expect(r.nearOrphans).toEqual(['https://x.com/a']);
  });

  it('never marks the homepage as orphan', () => {
    const g = makeGraph(['https://x.com/'], []);
    const r = detectOrphans(g, 'https://x.com/');
    expect(r.orphans).not.toContain('https://x.com/');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test orphans`
Expected: FAIL.

- [ ] **Step 3: Implement `orphans.ts`**

```ts
import type { SiteGraph } from '../graph.js';

export interface OrphanResult {
  orphans: string[];
  nearOrphans: string[];
  orphanRatio: number;
}

export function detectOrphans(graph: SiteGraph, homepageUrl: string): OrphanResult {
  const orphans: string[] = [];
  const nearOrphans: string[] = [];
  graph.forEachNode((node) => {
    if (node === homepageUrl) return;
    const inDeg = graph.inDegree(node);
    if (inDeg === 0) orphans.push(node);
    else if (inDeg <= 2) nearOrphans.push(node);
  });
  return {
    orphans,
    nearOrphans,
    orphanRatio: graph.order > 0 ? orphans.length / graph.order : 0,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test orphans`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/analysis/orphans.ts packages/engine/src/analysis/orphans.test.ts
git commit -m "feat(engine): orphan + near-orphan detection"
```

---

### Task 13: Click-depth BFS

**Files:**
- Create: `packages/engine/src/analysis/depth.ts`
- Create: `packages/engine/src/analysis/depth.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computeDepth } from './depth.js';
import type { SiteGraph } from '../graph.js';

function makeGraph(nodes: string[], edges: [string, string][]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const n of nodes) g.addNode(n, { urlHash: '', statusCode: 200 });
  for (const [a, b] of edges) g.addDirectedEdge(a, b, { anchorText: '', isGenericAnchor: false });
  return g;
}

describe('computeDepth', () => {
  it('assigns depth 0 to homepage and BFS distance to others', () => {
    const g = makeGraph(
      ['/', '/a', '/b', '/c'],
      [['/', '/a'], ['/a', '/b'], ['/b', '/c']],
    );
    const d = computeDepth(g, '/');
    expect(d.get('/')).toBe(0);
    expect(d.get('/a')).toBe(1);
    expect(d.get('/b')).toBe(2);
    expect(d.get('/c')).toBe(3);
  });

  it('takes shortest path when multiple paths exist', () => {
    const g = makeGraph(['/', '/a', '/b'], [['/', '/a'], ['/a', '/b'], ['/', '/b']]);
    expect(computeDepth(g, '/').get('/b')).toBe(1);
  });

  it('leaves unreachable pages undefined', () => {
    const g = makeGraph(['/', '/orphan'], []);
    const d = computeDepth(g, '/');
    expect(d.has('/orphan')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test depth`
Expected: FAIL.

- [ ] **Step 3: Implement `depth.ts`**

```ts
import type { SiteGraph } from '../graph.js';

export function computeDepth(graph: SiteGraph, homepageUrl: string): Map<string, number> {
  const depths = new Map<string, number>();
  if (!graph.hasNode(homepageUrl)) return depths;
  depths.set(homepageUrl, 0);
  const queue: string[] = [homepageUrl];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const d = depths.get(node)!;
    graph.forEachOutNeighbor(node, (neighbor) => {
      if (!depths.has(neighbor)) {
        depths.set(neighbor, d + 1);
        queue.push(neighbor);
      }
    });
  }
  return depths;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test depth`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/analysis/depth.ts packages/engine/src/analysis/depth.test.ts
git commit -m "feat(engine): BFS click-depth computation"
```

---

### Task 14: Anchor concentration (HHI) + generic anchor stats

**Files:**
- Create: `packages/engine/src/analysis/anchor.ts`
- Create: `packages/engine/src/analysis/anchor.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { anchorHHI, genericAnchorFraction, perTargetHHI } from './anchor.js';
import type { SiteGraph } from '../graph.js';

function makeGraph(nodes: string[], edges: { from: string; to: string; anchor: string; generic?: boolean }[]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const n of nodes) g.addNode(n, { urlHash: '', statusCode: 200 });
  for (const e of edges) g.addDirectedEdge(e.from, e.to, { anchorText: e.anchor, isGenericAnchor: !!e.generic });
  return g;
}

describe('anchorHHI', () => {
  it('is 1.0 when one anchor dominates', () => {
    expect(anchorHHI(['shoes', 'shoes', 'shoes'])).toBeCloseTo(1);
  });
  it('is low when anchors are diverse', () => {
    expect(anchorHHI(['a', 'b', 'c', 'd'])).toBeCloseTo(0.25);
  });
  it('is 0 for empty', () => {
    expect(anchorHHI([])).toBe(0);
  });
});

describe('perTargetHHI', () => {
  it('flags over-optimized targets', () => {
    const g = makeGraph(
      ['/', '/p'],
      [
        { from: '/', to: '/p', anchor: 'shoes' },
        { from: '/', to: '/p', anchor: 'shoes' },
      ],
    );
    // Graph dedupes parallel edges; create separate sources instead
    const g2 = makeGraph(
      ['/', '/x', '/y', '/z', '/p'],
      [
        { from: '/', to: '/p', anchor: 'shoes' },
        { from: '/x', to: '/p', anchor: 'shoes' },
        { from: '/y', to: '/p', anchor: 'shoes' },
        { from: '/z', to: '/p', anchor: 'other' },
      ],
    );
    const result = perTargetHHI(g2);
    expect(result.get('/p')).toBeGreaterThan(0.5);
  });
});

describe('genericAnchorFraction', () => {
  it('computes fraction of edges marked generic', () => {
    const g = makeGraph(
      ['/', '/a', '/b'],
      [
        { from: '/', to: '/a', anchor: 'A', generic: false },
        { from: '/', to: '/b', anchor: 'Click here', generic: true },
      ],
    );
    expect(genericAnchorFraction(g)).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test anchor`
Expected: FAIL.

- [ ] **Step 3: Implement `anchor.ts`**

```ts
import type { SiteGraph } from '../graph.js';

export function anchorHHI(anchors: string[]): number {
  if (anchors.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const a of anchors) {
    const k = a.trim().toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = anchors.length;
  let hhi = 0;
  for (const c of counts.values()) hhi += Math.pow(c / total, 2);
  return hhi;
}

export function perTargetHHI(graph: SiteGraph): Map<string, number> {
  const out = new Map<string, number>();
  graph.forEachNode((node) => {
    const anchors: string[] = [];
    graph.forEachInEdge(node, (_e, attrs) => {
      if (attrs.anchorText) anchors.push(attrs.anchorText);
    });
    if (anchors.length >= 3) out.set(node, anchorHHI(anchors));
  });
  return out;
}

export function genericAnchorFraction(graph: SiteGraph): number {
  let total = 0;
  let generic = 0;
  graph.forEachEdge((_e, attrs) => {
    total += 1;
    if (attrs.isGenericAnchor) generic += 1;
  });
  return total === 0 ? 0 : generic / total;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test anchor`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/analysis/anchor.ts packages/engine/src/analysis/anchor.test.ts
git commit -m "feat(engine): HHI anchor concentration + generic anchor fraction"
```

---

### Task 15: PageRank-lite hub authority

**Files:**
- Create: `packages/engine/src/analysis/pagerank.ts`
- Create: `packages/engine/src/analysis/pagerank.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computePageRank, giniCoefficient } from './pagerank.js';
import type { SiteGraph } from '../graph.js';

function makeGraph(edges: [string, string][]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const [a, b] of edges) {
    if (!g.hasNode(a)) g.addNode(a, { urlHash: '', statusCode: 200 });
    if (!g.hasNode(b)) g.addNode(b, { urlHash: '', statusCode: 200 });
    g.addDirectedEdge(a, b, { anchorText: '', isGenericAnchor: false });
  }
  return g;
}

describe('computePageRank', () => {
  it('produces values summing to ~1', () => {
    const g = makeGraph([['/', '/a'], ['/', '/b'], ['/a', '/b']]);
    const ranks = computePageRank(g);
    const sum = Array.from(ranks.values()).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it('ranks well-linked pages higher than orphans', () => {
    const g = makeGraph([['/', '/a'], ['/', '/b'], ['/a', '/b']]);
    g.addNode('/orphan', { urlHash: '', statusCode: 200 });
    const ranks = computePageRank(g);
    expect(ranks.get('/b')! > ranks.get('/orphan')!).toBe(true);
  });
});

describe('giniCoefficient', () => {
  it('is 0 for perfectly equal distribution', () => {
    expect(giniCoefficient([1, 1, 1, 1])).toBeCloseTo(0, 2);
  });
  it('is high for unequal distribution', () => {
    expect(giniCoefficient([10, 0, 0, 0])).toBeGreaterThan(0.7);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test pagerank`
Expected: FAIL.

- [ ] **Step 3: Implement `pagerank.ts`**

```ts
import pagerank from 'graphology-pagerank';
import type { SiteGraph } from '../graph.js';

export function computePageRank(graph: SiteGraph): Map<string, number> {
  const scores = pagerank(graph, { alpha: 0.85, maxIterations: 100, tolerance: 1e-6 });
  return new Map(Object.entries(scores));
}

export function giniCoefficient(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let cumulative = 0;
  for (let i = 0; i < n; i++) cumulative += (i + 1) * sorted[i]!;
  return (2 * cumulative) / (n * total) - (n + 1) / n;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test pagerank`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/analysis/pagerank.ts packages/engine/src/analysis/pagerank.test.ts
git commit -m "feat(engine): PageRank-lite hub authority + Gini coefficient"
```

---

### Task 16: Grade formula + letter mapping

**Files:**
- Create: `packages/engine/src/grade.ts`
- Create: `packages/engine/src/grade.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { scoreToLetter, computeGrade } from './grade.js';

describe('scoreToLetter', () => {
  it.each([
    [95, 'A'], [90, 'A'], [89, 'A-'], [85, 'A-'],
    [84, 'B+'], [80, 'B+'], [79, 'B'], [75, 'B'],
    [74, 'B-'], [70, 'B-'], [69, 'C+'], [65, 'C+'],
    [64, 'C'], [60, 'C'], [59, 'C-'], [55, 'C-'],
    [54, 'D+'], [50, 'D+'], [49, 'D'], [45, 'D'],
    [44, 'D-'], [40, 'D-'], [39, 'F'], [0, 'F'],
  ])('score %d -> %s', (score, expected) => {
    expect(scoreToLetter(score)).toBe(expected);
  });
});

describe('computeGrade', () => {
  it('returns 100 for perfect inputs', () => {
    const r = computeGrade({
      orphanRatio: 0,
      pagesBeyondDepth3Fraction: 0,
      unreachableFraction: 0,
      meanAnchorHHI: 0,
      genericAnchorFraction: 0,
      pageRankGini: 0,
    });
    expect(r.score).toBeCloseTo(100, 0);
    expect(r.grade).toBe('A');
  });

  it('returns ~0 for worst-case inputs', () => {
    const r = computeGrade({
      orphanRatio: 1,
      pagesBeyondDepth3Fraction: 1,
      unreachableFraction: 1,
      meanAnchorHHI: 1,
      genericAnchorFraction: 1,
      pageRankGini: 1,
    });
    expect(r.score).toBeLessThan(10);
    expect(r.grade).toBe('F');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test grade`
Expected: FAIL.

- [ ] **Step 3: Implement `grade.ts`**

```ts
import type { GradeBreakdown } from '@crawlmouse/types';

export interface GradeInputs {
  orphanRatio: number;                  // 0..1
  pagesBeyondDepth3Fraction: number;    // 0..1
  unreachableFraction: number;          // 0..1
  meanAnchorHHI: number;                // 0..1
  genericAnchorFraction: number;        // 0..1
  pageRankGini: number;                 // 0..1
}

export interface GradeResult {
  score: number;          // 0..100
  grade: string;
  breakdown: GradeBreakdown;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function computeGrade(inputs: GradeInputs): GradeResult {
  const orphanRatioScore = clamp(1 - inputs.orphanRatio);
  const depthScore = clamp(1 - (inputs.pagesBeyondDepth3Fraction + 0.5 * inputs.unreachableFraction));
  const baseAnchor = clamp(1 - inputs.meanAnchorHHI);
  const anchorDiversityScore = clamp(
    baseAnchor - (inputs.genericAnchorFraction > 0.2 ? 0.2 : 0),
  );
  const structureScore = clamp(1 - inputs.pageRankGini);

  const score =
    40 * orphanRatioScore +
    20 * depthScore +
    20 * anchorDiversityScore +
    20 * structureScore;

  return {
    score: Math.round(score * 100) / 100,
    grade: scoreToLetter(score),
    breakdown: { orphanRatioScore, depthScore, anchorDiversityScore, structureScore },
  };
}

export function scoreToLetter(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 85) return 'A-';
  if (score >= 80) return 'B+';
  if (score >= 75) return 'B';
  if (score >= 70) return 'B-';
  if (score >= 65) return 'C+';
  if (score >= 60) return 'C';
  if (score >= 55) return 'C-';
  if (score >= 50) return 'D+';
  if (score >= 45) return 'D';
  if (score >= 40) return 'D-';
  return 'F';
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test grade`
Expected: green.

- [ ] **Step 5: Export, commit**

Append to `packages/engine/src/index.ts`:

```ts
export { computeGrade, scoreToLetter } from './grade.js';
export type { GradeInputs, GradeResult } from './grade.js';
```

```bash
git add packages/engine/src/grade.ts packages/engine/src/grade.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): composite grade formula with letter mapping"
```

---

### Task 17: CMS-aware adjustments (Shopify minimum for v1.0)

**Files:**
- Create: `packages/engine/src/cms-adjustments/index.ts`
- Create: `packages/engine/src/cms-adjustments/shopify.ts`
- Create: `packages/engine/src/cms-adjustments/wordpress.ts`
- Create: `packages/engine/src/cms-adjustments/generic.ts`

These are pluggable: each CMS exports an `excludeFromOrphans(url): boolean` and a hook for future analyzer adjustments.

- [ ] **Step 1: Create the registry**

`packages/engine/src/cms-adjustments/index.ts`:

```ts
import type { CmsName } from '@crawlmouse/types';
import { shopifyAdjustments } from './shopify.js';
import { wordpressAdjustments } from './wordpress.js';
import { genericAdjustments } from './generic.js';

export interface CmsAdjustments {
  excludeFromOrphans: (url: string) => boolean;
}

export function getAdjustments(cms: CmsName): CmsAdjustments {
  switch (cms) {
    case 'shopify': return shopifyAdjustments;
    case 'wordpress': return wordpressAdjustments;
    default: return genericAdjustments;
  }
}
```

- [ ] **Step 2: Create `shopify.ts`**

```ts
import type { CmsAdjustments } from './index.js';

const SHOPIFY_EXCLUDED_PATHS = [
  /^\/cart/,
  /^\/checkout/,
  /^\/account/,
  /^\/policies/,
  /^\/search/,
  /^\/products\.json/,
  /^\/collections\.json/,
];

export const shopifyAdjustments: CmsAdjustments = {
  excludeFromOrphans(url: string) {
    try {
      const u = new URL(url);
      return SHOPIFY_EXCLUDED_PATHS.some((p) => p.test(u.pathname));
    } catch {
      return false;
    }
  },
};
```

- [ ] **Step 3: Create `wordpress.ts`**

```ts
import type { CmsAdjustments } from './index.js';

const WP_EXCLUDED = [
  /^\/wp-admin/,
  /^\/wp-login/,
  /^\/wp-json/,
  /^\/feed/,
  /^\/category\//,
  /^\/tag\//,
  /^\/author\//,
];

export const wordpressAdjustments: CmsAdjustments = {
  excludeFromOrphans(url: string) {
    try {
      const u = new URL(url);
      return WP_EXCLUDED.some((p) => p.test(u.pathname));
    } catch {
      return false;
    }
  },
};
```

- [ ] **Step 4: Create `generic.ts`**

```ts
import type { CmsAdjustments } from './index.js';

const GENERIC_EXCLUDED = [/^\/login/, /^\/cart/, /^\/checkout/, /^\/account/];

export const genericAdjustments: CmsAdjustments = {
  excludeFromOrphans(url: string) {
    try {
      const u = new URL(url);
      return GENERIC_EXCLUDED.some((p) => p.test(u.pathname));
    } catch {
      return false;
    }
  },
};
```

- [ ] **Step 5: Export, commit**

Append to `packages/engine/src/index.ts`:

```ts
export { getAdjustments } from './cms-adjustments/index.js';
export type { CmsAdjustments } from './cms-adjustments/index.js';
```

```bash
git add packages/engine/src/cms-adjustments packages/engine/src/index.ts
git commit -m "feat(engine): CMS-aware exclusions for Shopify, WordPress, generic"
```

---

### Task 18: Top-level audit orchestrator (`runAudit`)

**Files:**
- Create: `packages/engine/src/audit.ts`
- Create: `packages/engine/src/audit.test.ts`

This is the public entry point that ties everything together. The Inngest function (Task 20) and the CLI smoke test (Task 22) both call this.

- [ ] **Step 1: Write the end-to-end test (uses an inline HTTP server)**

`packages/engine/src/audit.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runAudit } from './audit.js';

let server: http.Server;
let baseUrl: string;

const sitemap = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>BASE/</loc></url>
  <url><loc>BASE/a</loc></url>
  <url><loc>BASE/b</loc></url>
  <url><loc>BASE/orphan</loc></url>
</urlset>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/sitemap.xml') {
      res.setHeader('content-type', 'application/xml');
      res.end(sitemap.replaceAll('BASE', baseUrl));
      return;
    }
    if (path === '/robots.txt') {
      res.statusCode = 404; res.end(''); return;
    }
    res.setHeader('content-type', 'text/html');
    if (path === '/' || path === '') {
      res.end(`<html><head><title>Home</title></head><body>
        <a href="/a">A</a><a href="/b">B</a>
      </body></html>`);
    } else if (path === '/a') {
      res.end(`<html><head><title>A</title></head><body><a href="/b">B</a></body></html>`);
    } else if (path === '/b') {
      res.end(`<html><head><title>B</title></head><body></body></html>`);
    } else if (path === '/orphan') {
      res.end(`<html><head><title>Orphan</title></head><body></body></html>`);
    } else {
      res.statusCode = 404; res.end('');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('runAudit', () => {
  it('produces a complete AuditResult', async () => {
    const result = await runAudit({
      url: baseUrl,
      pageCap: 50,
      perHostConcurrency: 2,
      staggerMs: 0,
      pageTimeoutMs: 5000,
    }, { allowPrivateIpsForTesting: true });

    expect(result.url).toBe(baseUrl);
    expect(result.cms).toBe('custom');
    expect(result.pages.length).toBe(4);
    expect(result.findings.some((f) => f.category === 'orphan')).toBe(true);
    expect(['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']).toContain(result.grade);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/engine test audit`
Expected: FAIL.

- [ ] **Step 3: Implement `audit.ts`**

```ts
import type { AuditOptions, AuditResult, Page, Link, Finding, CmsMetadata } from '@crawlmouse/types';
import { runCrawl } from './crawler.js';
import { buildGraph } from './graph.js';
import { detectOrphans } from './analysis/orphans.js';
import { computeDepth } from './analysis/depth.js';
import { perTargetHHI, genericAnchorFraction } from './analysis/anchor.js';
import { computePageRank, giniCoefficient } from './analysis/pagerank.js';
import { computeGrade } from './grade.js';
import { detectCms } from './cms-detection/index.js';
import { getAdjustments } from './cms-adjustments/index.js';
import { discoverSitemaps, parseSitemapUrls } from './sitemap.js';
import { hashUrl, canonicalizeUrl } from './url-canonical.js';

export interface InternalAuditFlags {
  allowPrivateIpsForTesting?: boolean;
}

export async function runAudit(opts: AuditOptions, flags: InternalAuditFlags = {}): Promise<AuditResult> {
  const startedAt = new Date();
  const origin = new URL(opts.url).origin;
  const homepageUrl = canonicalizeUrl(origin);

  // Fetch homepage HTML for CMS detection (also seeds the crawl)
  const homepageRes = await fetch(homepageUrl);
  const html = await homepageRes.text();
  const headers: Record<string, string> = {};
  homepageRes.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const detection = detectCms(html, headers);
  const cmsMetadata: CmsMetadata = {};   // populated in v1.1+ with deeper fingerprinting

  // Sitemap discovery
  const fetcher = async (u: string) => {
    const r = await fetch(u);
    return { status: r.status, body: await r.text() };
  };
  const discovered = await discoverSitemaps(origin, { fetcher });
  let seedUrls: string[];
  if (discovered.sitemapUrls.length > 0) {
    const all: string[] = [];
    for (const sm of discovered.sitemapUrls) all.push(...await parseSitemapUrls(sm, { fetcher }));
    seedUrls = Array.from(new Set([homepageUrl, ...all.map(canonicalizeUrl)])).slice(0, opts.pageCap ?? 500);
  } else {
    seedUrls = [homepageUrl];
  }

  // Crawl
  const crawlOut = await runCrawl({
    startUrls: seedUrls,
    pageCap: opts.pageCap ?? 500,
    perHostConcurrency: opts.perHostConcurrency ?? 8,
    staggerMs: opts.staggerMs ?? 250,
    pageTimeoutMs: opts.pageTimeoutMs ?? 10000,
    basicAuth: opts.basicAuth,
    extraHeaders: opts.extraHeaders,
    allowPrivateIpsForTesting: flags.allowPrivateIpsForTesting,
  });

  // Build graph
  const graph = buildGraph(crawlOut.pages, crawlOut.links);

  // Apply CMS-aware exclusions to orphan detection
  const adjust = getAdjustments(detection.cms);
  const orphanResult = detectOrphans(graph, homepageUrl);
  const filteredOrphans = orphanResult.orphans.filter((u) => !adjust.excludeFromOrphans(u));
  const orphanRatio = graph.order > 0 ? filteredOrphans.length / graph.order : 0;

  // Depth
  const depths = computeDepth(graph, homepageUrl);
  const beyond3 = Array.from(depths.values()).filter((d) => d > 3).length;
  const unreachable = graph.order - depths.size;
  const pagesBeyondDepth3Fraction = graph.order > 0 ? beyond3 / graph.order : 0;
  const unreachableFraction = graph.order > 0 ? unreachable / graph.order : 0;

  // Anchor analysis
  const hhiMap = perTargetHHI(graph);
  const meanHHI = hhiMap.size > 0 ? Array.from(hhiMap.values()).reduce((a, b) => a + b, 0) / hhiMap.size : 0;
  const genericFrac = genericAnchorFraction(graph);

  // PageRank
  const ranks = computePageRank(graph);
  const gini = giniCoefficient(Array.from(ranks.values()));

  // Grade
  const grade = computeGrade({
    orphanRatio,
    pagesBeyondDepth3Fraction,
    unreachableFraction,
    meanAnchorHHI: meanHHI,
    genericAnchorFraction: genericFrac,
    pageRankGini: gini,
  });

  // Build pages + links + findings outputs
  const pages: Page[] = crawlOut.pages.map((p) => ({
    url: p.url,
    urlHash: p.urlHash,
    title: p.title,
    statusCode: p.statusCode,
    depth: depths.get(p.url) ?? null,
    inDegree: graph.hasNode(p.url) ? graph.inDegree(p.url) : 0,
    outDegree: graph.hasNode(p.url) ? graph.outDegree(p.url) : 0,
    isOrphan: filteredOrphans.includes(p.url),
  }));

  const links: Link[] = crawlOut.links.map((l) => ({
    fromUrl: l.fromUrl,
    toUrl: l.toUrl,
    anchorText: l.anchorText,
    isGenericAnchor: l.isGenericAnchor,
  }));

  const findings: Finding[] = [];
  for (const u of filteredOrphans) findings.push({ category: 'orphan', severity: 'critical', pageUrl: u });
  for (const [url, d] of depths.entries()) if (d > 3) findings.push({ category: 'deep_page', severity: 'medium', pageUrl: url, payload: { depth: d } });
  for (const p of pages) if (p.depth === null && !filteredOrphans.includes(p.url)) findings.push({ category: 'unreachable_page', severity: 'critical', pageUrl: p.url });
  for (const [url, hhi] of hhiMap.entries()) if (hhi > 0.5) findings.push({ category: 'over_optimized_anchor', severity: 'medium', pageUrl: url, payload: { hhi } });
  if (genericFrac > 0.2) findings.push({ category: 'generic_anchor_overuse', severity: 'minor', payload: { fraction: genericFrac } });

  // void unused vars to satisfy strict TS for the unused 'html' constant (we read it for detection only)
  void hashUrl;

  return {
    url: opts.url,
    cms: detection.cms,
    cmsConfidence: detection.confidence,
    cmsMetadata,
    pages,
    links,
    findings,
    score: grade.score,
    grade: grade.grade,
    breakdown: grade.breakdown,
    startedAt,
    completedAt: new Date(),
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @crawlmouse/engine test audit`
Expected: green.

- [ ] **Step 5: Export, commit**

Append to `packages/engine/src/index.ts`:

```ts
export { runAudit } from './audit.js';
export type { InternalAuditFlags } from './audit.js';
```

```bash
git add packages/engine/src/audit.ts packages/engine/src/audit.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): end-to-end audit orchestrator runAudit()"
```

---

### Task 19: Supabase local + first migration (users + sessions)

**Files:**
- Create: `infra/supabase/config.toml`
- Create: `infra/supabase/migrations/20260524000001_init_users.sql`

- [ ] **Step 1: Install Supabase CLI globally (one-time)**

Run:
```bash
pnpm dlx supabase --version
```
Expected: prints CLI version. If not installed, follow https://supabase.com/docs/guides/local-development.

- [ ] **Step 2: Initialize Supabase in the repo**

Run:
```bash
pnpm dlx supabase init --workdir infra/supabase
```
Expected: `infra/supabase/config.toml` created.

- [ ] **Step 3: Start the local stack**

Run:
```bash
pnpm dlx supabase start --workdir infra/supabase
```
Expected: local Postgres + Auth + Storage running. Prints local API URL and anon/service keys.

- [ ] **Step 4: Create migration `20260524000001_init_users.sql`**

```sql
create extension if not exists "pgcrypto";

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  pro_until timestamptz,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on sessions (user_id);
```

- [ ] **Step 5: Apply migration**

Run:
```bash
pnpm dlx supabase migration up --workdir infra/supabase
```
Expected: applies the migration; verify with `pnpm dlx supabase db diff --workdir infra/supabase` (should show empty diff after).

- [ ] **Step 6: Commit**

```bash
git add infra/supabase
git commit -m "feat(db): supabase init + users + sessions migration"
```

---

### Task 20: Migration — audits + pages + links + findings + indexes

**Files:**
- Create: `infra/supabase/migrations/20260524000002_audits.sql`
- Create: `infra/supabase/migrations/20260524000003_indexes.sql`

- [ ] **Step 1: Create `20260524000002_audits.sql`**

```sql
create table audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  anonymous_session_id text,
  url text not null,
  status text not null default 'pending',
  cms_detected text,
  cms_metadata jsonb,
  page_count int,
  link_count int,
  score numeric(5,2),
  grade text,
  commit_sha text,
  environment text,
  branch text,
  deployment_id text,
  settings jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_reason text
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  url text not null,
  url_hash text not null,
  title text,
  status_code int not null,
  depth int,
  in_degree int not null default 0,
  out_degree int not null default 0,
  is_orphan boolean not null default false,
  unique (audit_id, url)
);

create table links (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  from_page_id uuid not null references pages(id) on delete cascade,
  to_page_id uuid not null references pages(id) on delete cascade,
  anchor_text text,
  is_generic_anchor boolean not null default false
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  category text not null,
  severity text not null,
  page_id uuid references pages(id) on delete cascade,
  payload jsonb
);
```

- [ ] **Step 2: Create `20260524000003_indexes.sql`**

```sql
create index on audits (user_id, started_at desc);
create index on audits (url, completed_at desc);
create index on pages (audit_id, is_orphan);
create index on links (audit_id, to_page_id);
create index on findings (audit_id, category);
```

- [ ] **Step 3: Apply both migrations**

Run: `pnpm dlx supabase migration up --workdir infra/supabase`
Expected: both apply cleanly.

- [ ] **Step 4: Commit**

```bash
git add infra/supabase/migrations
git commit -m "feat(db): audits + pages + links + findings + indexes"
```

---

### Task 21: Migration — RLS policies

**Files:**
- Create: `infra/supabase/migrations/20260524000004_rls.sql`

- [ ] **Step 1: Create the migration**

```sql
alter table users enable row level security;
alter table sessions enable row level security;
alter table audits enable row level security;
alter table pages enable row level security;
alter table links enable row level security;
alter table findings enable row level security;

-- users: each user can read/update only their own row
create policy users_self_read on users for select using (id = auth.uid());
create policy users_self_update on users for update using (id = auth.uid());

-- sessions: managed server-side via service role; deny client access
create policy sessions_deny_client on sessions for all using (false);

-- audits: owner can read; anonymous audits readable when anonymous_session_id matches header
create policy audits_owner_read on audits for select using (user_id = auth.uid());
create policy audits_owner_insert on audits for insert with check (user_id = auth.uid() or user_id is null);
create policy audits_owner_update on audits for update using (user_id = auth.uid());

-- pages: readable via parent audit ownership
create policy pages_via_audit on pages for select using (
  exists (select 1 from audits a where a.id = pages.audit_id and a.user_id = auth.uid())
);

-- links: ditto
create policy links_via_audit on links for select using (
  exists (select 1 from audits a where a.id = links.audit_id and a.user_id = auth.uid())
);

-- findings: ditto
create policy findings_via_audit on findings for select using (
  exists (select 1 from audits a where a.id = findings.audit_id and a.user_id = auth.uid())
);
```

- [ ] **Step 2: Apply**

Run: `pnpm dlx supabase migration up --workdir infra/supabase`
Expected: applies cleanly.

- [ ] **Step 3: Commit**

```bash
git add infra/supabase/migrations/20260524000004_rls.sql
git commit -m "feat(db): RLS policies for users/sessions/audits/pages/links/findings"
```

---

### Task 22: Inngest client + audit function

**Files:**
- Create: `inngest/package.json`
- Create: `inngest/tsconfig.json`
- Create: `inngest/client.ts`
- Create: `inngest/audit.ts`

This is the function that the API route will trigger to run an audit. v1.0 persists results directly; v1.1 will add embeddings + suggestions as additional steps.

- [ ] **Step 1: Create `inngest/package.json`**

```json
{
  "name": "@crawlmouse/inngest",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./client.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "echo 'no tests'"
  },
  "dependencies": {
    "@crawlmouse/engine": "workspace:*",
    "@crawlmouse/types": "workspace:*",
    "@supabase/supabase-js": "^2.45.0",
    "inngest": "^3.27.0"
  },
  "devDependencies": {
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Create `inngest/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "paths": {
      "@crawlmouse/engine": ["../packages/engine/src/index.ts"],
      "@crawlmouse/types": ["../packages/types/src/index.ts"]
    }
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `inngest/client.ts`**

```ts
import { Inngest, EventSchemas } from 'inngest';

type Events = {
  'audit.requested': {
    data: {
      auditId: string;
      url: string;
      pageCap?: number;
      basicAuth?: { username: string; password: string };
      extraHeaders?: Record<string, string>;
      commitSha?: string;
      environment?: string;
      branch?: string;
      deploymentId?: string;
    };
  };
  'audit.completed': { data: { auditId: string; grade: string; score: number } };
  'audit.failed': { data: { auditId: string; reason: string } };
};

export const inngest = new Inngest({
  id: 'crawlmouse',
  schemas: new EventSchemas().fromRecord<Events>(),
});
```

- [ ] **Step 4: Create `inngest/audit.ts`**

```ts
import { inngest } from './client.js';
import { runAudit } from '@crawlmouse/engine';
import { createClient } from '@supabase/supabase-js';

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export const auditFn = inngest.createFunction(
  { id: 'crawlmouse.audit', concurrency: { limit: 50 } },
  { event: 'audit.requested' },
  async ({ event, step }) => {
    const sb = supabaseAdmin();
    const { auditId, url, pageCap } = event.data;

    await step.run('mark-crawling', async () => {
      await sb.from('audits').update({ status: 'crawling' }).eq('id', auditId);
    });

    const result = await step.run('run-engine', async () => {
      try {
        return await runAudit({
          url,
          pageCap: pageCap ?? 500,
          perHostConcurrency: 8,
          staggerMs: 250,
          pageTimeoutMs: 10000,
          basicAuth: event.data.basicAuth,
          extraHeaders: event.data.extraHeaders,
          commitSha: event.data.commitSha,
          environment: event.data.environment,
          branch: event.data.branch,
          deploymentId: event.data.deploymentId,
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'unknown';
        await sb.from('audits').update({ status: 'failed', failure_reason: reason, completed_at: new Date().toISOString() }).eq('id', auditId);
        throw e;
      }
    });

    await step.run('persist-results', async () => {
      // Update audit
      await sb.from('audits').update({
        status: 'completed',
        cms_detected: result.cms,
        cms_metadata: result.cmsMetadata,
        page_count: result.pages.length,
        link_count: result.links.length,
        score: result.score,
        grade: result.grade,
        completed_at: result.completedAt.toISOString(),
      }).eq('id', auditId);

      // Insert pages, get back IDs
      const pageRows = result.pages.map((p) => ({
        audit_id: auditId,
        url: p.url,
        url_hash: p.urlHash,
        title: p.title,
        status_code: p.statusCode,
        depth: p.depth,
        in_degree: p.inDegree,
        out_degree: p.outDegree,
        is_orphan: p.isOrphan,
      }));
      const { data: insertedPages } = await sb.from('pages').insert(pageRows).select('id, url');
      const urlToPageId = new Map<string, string>((insertedPages ?? []).map((p: { id: string; url: string }) => [p.url, p.id]));

      // Insert links (resolve URL -> page_id)
      const linkRows = result.links
        .map((l) => ({
          audit_id: auditId,
          from_page_id: urlToPageId.get(l.fromUrl),
          to_page_id: urlToPageId.get(l.toUrl),
          anchor_text: l.anchorText,
          is_generic_anchor: l.isGenericAnchor,
        }))
        .filter((r) => r.from_page_id && r.to_page_id);
      if (linkRows.length > 0) await sb.from('links').insert(linkRows);

      // Insert findings
      const findingRows = result.findings.map((f) => ({
        audit_id: auditId,
        category: f.category,
        severity: f.severity,
        page_id: f.pageUrl ? urlToPageId.get(f.pageUrl) ?? null : null,
        payload: f.payload ?? null,
      }));
      if (findingRows.length > 0) await sb.from('findings').insert(findingRows);
    });

    await step.sendEvent('emit-completed', {
      name: 'audit.completed',
      data: { auditId, grade: result.grade, score: result.score },
    });

    return { auditId, grade: result.grade, score: result.score };
  },
);
```

- [ ] **Step 5: Install + typecheck**

Run: `pnpm install`
Then: `pnpm --filter @crawlmouse/inngest typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add inngest pnpm-lock.yaml
git commit -m "feat(jobs): Inngest audit function with engine + Supabase persistence"
```

---

### Task 23: CLI smoke test script

**Files:**
- Create: `scripts/package.json`
- Create: `scripts/tsconfig.json`
- Create: `scripts/smoke-crawl.ts`

Runs `runAudit` directly (no Inngest, no DB) against a real URL and prints the result. Used for manual validation during build + nightly CI smoke testing.

- [ ] **Step 1: Create `scripts/package.json`**

```json
{
  "name": "@crawlmouse/scripts",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "smoke": "tsx smoke-crawl.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@crawlmouse/engine": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Create `scripts/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "paths": { "@crawlmouse/engine": ["../packages/engine/src/index.ts"] }
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 3: Create `scripts/smoke-crawl.ts`**

```ts
import { runAudit } from '@crawlmouse/engine';

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(flag));
  return found ? found.slice(flag.length) : undefined;
}

const url = arg('url') ?? process.argv[2];
if (!url) {
  console.error('Usage: pnpm smoke -- --url=https://example.com');
  process.exit(1);
}

const pageCap = Number(arg('pageCap') ?? 100);

console.log(`Auditing ${url} (page cap: ${pageCap})...`);
const start = Date.now();
const result = await runAudit({ url, pageCap, perHostConcurrency: 4, staggerMs: 250, pageTimeoutMs: 10000 });
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log('\n=== Result ===');
console.log(`URL: ${result.url}`);
console.log(`CMS: ${result.cms} (confidence ${(result.cmsConfidence * 100).toFixed(0)}%)`);
console.log(`Pages: ${result.pages.length}`);
console.log(`Links: ${result.links.length}`);
console.log(`Grade: ${result.grade}  Score: ${result.score.toFixed(2)}/100`);
console.log(`Time: ${elapsed}s\n`);

const findingCounts = result.findings.reduce<Record<string, number>>((acc, f) => {
  acc[f.category] = (acc[f.category] ?? 0) + 1; return acc;
}, {});
console.log('Findings:');
for (const [cat, n] of Object.entries(findingCounts)) console.log(`  ${cat}: ${n}`);
```

- [ ] **Step 4: Run smoke test against a public site**

Run:
```bash
pnpm install
pnpm smoke -- --url=https://deathwishcoffee.com --pageCap=50
```
Expected: prints CMS detection (Shopify), pages count > 0, a grade letter, finding category counts. Should complete in 30–90 seconds.

- [ ] **Step 5: Commit**

```bash
git add scripts pnpm-lock.yaml
git commit -m "feat(scripts): CLI smoke test for the audit engine"
```

---

### Task 24: Final E2E smoke validation against 3 real sites

This task is manual verification (no new files). Catches integration regressions before we move to Plan 2.

- [ ] **Step 1: Run smoke against a Shopify store**

```bash
pnpm smoke -- --url=https://deathwishcoffee.com --pageCap=100
```
Verify:
- CMS detected as `shopify` with confidence > 0.5
- Page count > 20
- Grade letter present
- Completes within 2 minutes

- [ ] **Step 2: Run smoke against a WordPress site**

```bash
pnpm smoke -- --url=https://wordpress.org --pageCap=100
```
Verify:
- CMS detected as `wordpress`
- Page count > 20
- Grade present

- [ ] **Step 3: Run smoke against a Webflow site**

```bash
pnpm smoke -- --url=https://webflow.com --pageCap=100
```
Verify:
- CMS detected as `webflow`
- Page count > 20
- Grade present

- [ ] **Step 4: Run all tests one final time**

```bash
pnpm test
pnpm typecheck
```
Expected: all green.

- [ ] **Step 5: Tag the milestone**

```bash
git tag plan-1-engine-foundation-complete
git log --oneline | head -25
```

Plan 1 complete. The engine works end-to-end on real sites, persists to Postgres via Inngest, and is ready to be consumed by the web app (Plan 2).

---

## Plan 1 Self-Review

- **Spec coverage:** Every algorithm in §7 of the spec is implemented (orphans, depth BFS, HHI, generic anchor, PageRank-lite). Grade formula in §8 implemented with correct weights and letter mapping. CMS detection in §9 covers all 8 platforms (`custom` as fallback). Data model in §4.1 implemented (users, sessions, audits, pages, links, findings, indexes, RLS). The v1.2-ready columns are present on `audits` (`commit_sha`, `environment`, `branch`, `deployment_id`). The Inngest function shape in §6.3 / §12 is implemented. SSRF guard from §14.1 is implemented and tested with explicit IP cases. Crawler politeness from §6.4 (UA, concurrency, stagger) is honored.
- **Placeholder scan:** no TBDs/TODOs in code or steps. Every step has either a code block or an exact command + expected output.
- **Type consistency:** `AuditOptions`, `AuditResult`, `Page`, `Link`, `Finding`, `AuditEvent` defined once in `@crawlmouse/types`, imported by engine + inngest. Function signatures (`runAudit`, `runCrawl`, `buildGraph`, `detectOrphans`, `computeDepth`, `perTargetHHI`, `genericAnchorFraction`, `computePageRank`, `computeGrade`, `scoreToLetter`) consistently referenced across tasks.
- **Deferred (intentional):** RLS policies for `embed_badges`, `domain_verifications`, `public_reports`, `benchmark_cohorts`, `api_keys`, `webhook_subscriptions`, `rate_limits`, `stripe_events`, `scheduled_audits`, `page_embeddings` — those tables don't exist yet in Plan 1; they ship in their respective plans (Plan 3 / Plan 4 / v1.1). SSE/webhook delivery infrastructure ships in Plan 2 (when we have a Next.js app to host the SSE route). Frontend, auth, billing all deferred to later plans by design.

Self-review complete. The plan is ready to execute.

---

*Next: Plans 2 through 5 will be written in sequence as we approach execution of each. Plan 2 (Web App + Auth) will begin from this Plan 1's completed engine + database state.*
