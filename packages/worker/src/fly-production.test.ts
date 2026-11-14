import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// fly.production.toml is fly.toml with the app's name changed and nothing else (SPEC 35, D1). These
// tests parse both files and compare every key, so a setting changed in one file and not the other
// fails here rather than shipping a production worker unlike the one staging measured.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stagingText = read('../fly.toml');
const productionText = read('../fly.production.toml');

type Table = { [key: string]: Value };
type Value = string | number | boolean | Table | Table[];

/**
 * Parses the TOML subset the Fly files use: `#` comments, `[table]` and `[[array.of.tables]]`
 * headers with dotted bare keys, and `key = value` where the value is a double-quoted string with no
 * escape, an integer or a boolean. Anything else throws, so a file that grows other syntax fails
 * these tests instead of being read wrongly.
 */
function parseFlyToml(text: string): Table {
  const root: Table = {};
  let current = root;
  const bare = /^[A-Za-z0-9_-]+$/;
  const path = (raw: string, line: number) => {
    const keys = raw.split('.').map((k) => k.trim());
    for (const k of keys) if (!bare.test(k)) throw new Error(`line ${line}: key "${k}"`);
    return keys;
  };
  /** The table at the end of `keys`, made where missing; through an array, its last table. */
  const walk = (keys: string[], line: number): Table => {
    let at = root;
    for (const k of keys) {
      if (!Object.hasOwn(at, k)) at[k] = {};
      const next = at[k];
      if (Array.isArray(next)) at = next[next.length - 1]!;
      else if (typeof next === 'object') at = next;
      else throw new Error(`line ${line}: ${k} is a value, not a table`);
    }
    return at;
  };
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const text = raw.trim();
    if (text === '' || text.startsWith('#')) return;
    const array = /^\[\[([^[\]]+)\]\]$/.exec(text);
    const table = /^\[([^[\]]+)\]$/.exec(text);
    if (array) {
      const keys = path(array[1]!, line);
      const parent = walk(keys.slice(0, -1), line);
      const last = keys[keys.length - 1]!;
      const existing = Object.hasOwn(parent, last) ? parent[last] : undefined;
      if (existing !== undefined && !Array.isArray(existing))
        throw new Error(`line ${line}: ${last} is not an array of tables`);
      const list = (existing ?? []) as Table[];
      current = {};
      list.push(current);
      parent[last] = list;
      return;
    }
    if (table) {
      current = walk(path(table[1]!, line), line);
      return;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(text);
    if (!pair) throw new Error(`line ${line}: cannot read "${text}"`);
    const [, key, rawValue] = pair as unknown as [string, string, string];
    if (Object.hasOwn(current, key)) throw new Error(`line ${line}: ${key} is set twice`);
    let value: Value;
    const quoted = /^"([^"\\]*)"$/.exec(rawValue);
    if (quoted) value = quoted[1]!;
    else if (/^-?\d+$/.test(rawValue)) value = Number(rawValue);
    else if (rawValue === 'true' || rawValue === 'false') value = rawValue === 'true';
    else throw new Error(`line ${line}: cannot read the value ${rawValue}`);
    current[key] = value;
  });
  return root;
}

/** The dotted paths at which two parsed files differ: a value, a missing key, an array's length. */
function differingKeys(a: Value | undefined, b: Value | undefined, at = ''): string[] {
  const isTable = (v: Value | undefined): v is Table =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${at} (length)`];
    return a.flatMap((x, i) => differingKeys(x, b[i], `${at}[${i}]`));
  }
  if (isTable(a) && isTable(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) =>
      differingKeys(
        Object.hasOwn(a, k) ? a[k] : undefined,
        Object.hasOwn(b, k) ? b[k] : undefined,
        at ? `${at}.${k}` : k,
      ),
    );
  }
  return a === b ? [] : [at];
}

const staging = parseFlyToml(stagingText);
const production = parseFlyToml(productionText);

describe('packages/worker/fly.production.toml', () => {
  it('names the production app, crawlmouse-worker', () => {
    expect(production.app).toBe('crawlmouse-worker');
    expect(staging.app).toBe('crawlmouse-worker-staging');
  });

  it('differs from fly.toml in the key `app` and in no other key', () => {
    expect(differingKeys(staging, production)).toEqual(['app']);
  });

  it('reads every table of fly.toml, so the comparison is not over an empty file', () => {
    expect(Object.keys(staging).sort()).toEqual(
      [
        'app',
        'build',
        'env',
        'http_service',
        'kill_signal',
        'kill_timeout',
        'primary_region',
        'restart',
        'vm',
      ].sort(),
    );
    expect((staging.vm as Table[])[0]!.memory).toBe('1024mb');
    expect(((staging.http_service as Table).checks as Table[])[0]!.path).toBe('/healthz');
  });

  it('says production in its header comment, and staging nowhere', () => {
    expect(productionText.split('\n')[0]).toMatch(/^# The crawl worker in production\./);
    expect(productionText).not.toMatch(/staging/i);
  });
});

describe('the comparison, over a key at each depth and each kind of change', () => {
  const edited = (from: string, to: string) => {
    expect(productionText).toContain(from);
    return parseFlyToml(productionText.replace(from, to));
  };

  it.each([
    ['a top-level value', 'primary_region = "iad"', 'primary_region = "ams"', 'primary_region'],
    [
      'a key in a table',
      'BATCH_CONCURRENCY = "2"',
      'BATCH_CONCURRENCY = "4"',
      'env.BATCH_CONCURRENCY',
    ],
    [
      'a key in an array of tables, [[vm]] memory',
      'memory = "1024mb"',
      'memory = "2048mb"',
      'vm[0].memory',
    ],
    [
      'a key in a nested array of tables',
      'path = "/healthz"',
      'path = "/health"',
      'http_service.checks[0].path',
    ],
    [
      'a key in a nested table',
      'hard_limit = 25',
      'hard_limit = 50',
      'http_service.concurrency.hard_limit',
    ],
    ['a boolean', 'force_https = true', 'force_https = false', 'http_service.force_https'],
    ['a key added', '[[vm]]\n', '[[vm]]\n  cpus = 2\n', 'vm[0].cpus'],
    ['a key removed', '  min_machines_running = 1\n', '', 'http_service.min_machines_running'],
    ['a table repeated', '[[vm]]\n', '[[vm]]\n  size = "shared-cpu-1x"\n[[vm]]\n', 'vm (length)'],
  ])('finds %s', (_label, from, to, key) => {
    expect(differingKeys(staging, edited(from, to))).toEqual(['app', key].sort());
  });

  it('ignores a comment changed, so the header may say production', () => {
    expect(
      differingKeys(production, edited('# Batches run at once.', '# Something else.')),
    ).toEqual([]);
  });

  it.each([
    ['an inline table', 'x = { a = 1 }'],
    ['an escape in a string', 'x = "a\\"b"'],
    ['a multi-line string', 'x = """a"""'],
    ['an array value', 'x = ["a"]'],
    ['a float', 'x = 1.5'],
    ['a quoted key', '"x" = 1'],
    ['a key set twice', 'x = 1\nx = 2'],
  ])('refuses %s rather than reading it wrongly', (_label, text) => {
    expect(() => parseFlyToml(text)).toThrow();
  });
});
