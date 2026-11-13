import net from 'node:net';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAddress } from './address-ranges.js';
import { isPrivateOrReservedIp } from './ssrf-guard.js';

// ---------------------------------------------------------------------------------------------
// The guard as it was before it decided on bytes, copied here and nowhere else, so the first
// property can show that nothing it refused is now allowed. Only its name is changed.
// ---------------------------------------------------------------------------------------------

// prettier-ignore
function legacyNormalizeIPv6(ip: string): string {
  try {
    return new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return ip.toLowerCase();
  }
}

// prettier-ignore
function legacyIsPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return true; // not a valid IP - treat as reserved

  if (family === 4) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets as [number, number, number, number];
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // 10/8
    if (a === 127) return true;                     // loopback 127/8
    if (a === 169 && b === 254) return true;        // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true;        // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT (Alibaba metadata)
    return false;
  }

  // IPv6 - normalize first so non-canonical forms collapse
  const lower = legacyNormalizeIPv6(ip);

  // Loopback (::1) and unspecified (::) after canonical normalization
  if (lower === '::1' || lower === '::') return true;

  // IPv4-mapped IPv6: ::ffff:0:0/96 (dotted-decimal embedded form after normalization)
  // After URL normalization, ::ffff:169.254.169.254 becomes ::ffff:a9fe:a9fe (hex pairs).
  // Match the hex-pair form and extract the embedded v4 address.
  const ipv4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (ipv4MappedHex) {
    const hi = parseInt(ipv4MappedHex[1]!, 16);
    const lo = parseInt(ipv4MappedHex[2]!, 16);
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return legacyIsPrivateOrReservedIp(embedded);
  }
  // Also handle the dotted-decimal form in case normalization preserves it (it usually doesn't, but defensive).
  const ipv4MappedDecimal = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4MappedDecimal) {
    return legacyIsPrivateOrReservedIp(ipv4MappedDecimal[1]!);
  }
  // IPv4-compatible (deprecated): ::a.b.c.d or ::aabb:ccdd
  const ipv4CompatDecimal = lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4CompatDecimal) {
    return legacyIsPrivateOrReservedIp(ipv4CompatDecimal[1]!);
  }
  const ipv4CompatHex = lower.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (ipv4CompatHex) {
    const hi = parseInt(ipv4CompatHex[1]!, 16);
    const lo = parseInt(ipv4CompatHex[2]!, 16);
    // Only treat as v4-compat if the value looks like a real v4 (avoid false positives on real v6).
    // ::aabb:ccdd as v4-compat would be 0.171.205.221 - we conservatively check.
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (legacyIsPrivateOrReservedIp(embedded)) return true;
    // Fall through to other checks if not flagged - this is conservative.
  }

  // NAT64 (64:ff9b::/96) embeds an IPv4 in the low 32 bits, e.g.
  // 64:ff9b::a9fe:a9fe == 169.254.169.254. Reachable on NAT64-enabled (often
  // IPv6-only cloud) networks, so check the embedded v4.
  const nat64 = lower.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (nat64) {
    const hi = parseInt(nat64[1]!, 16);
    const lo = parseInt(nat64[2]!, 16);
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (legacyIsPrivateOrReservedIp(embedded)) return true;
  }
  // 6to4 (2002::/16) embeds an IPv4 in the first 32 bits after the prefix, e.g.
  // 2002:a9fe:a9fe:: == 169.254.169.254. Block when the embedded v4 is private.
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1]!, 16);
    const lo = parseInt(sixToFour[2]!, 16);
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (legacyIsPrivateOrReservedIp(embedded)) return true;
  }

  // Link-local fe80::/10 - first byte is 0xfe AND second byte is 0x80-0xbf
  const firstByte = parseInt(lower.slice(0, 2), 16);
  const secondByte = parseInt(lower.slice(2, 4), 16);
  if (firstByte === 0xfe && secondByte >= 0x80 && secondByte <= 0xbf) return true;

  // ULA fc00::/7 - first byte 0xfc or 0xfd
  if (firstByte === 0xfc || firstByte === 0xfd) return true;

  return false;
}

// ---------------------------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------------------------

const PRIVATE_V4 = [
  0x0a000001, 0x7f000001, 0xa9fea9fe, 0xac100001, 0xc0a80101, 0x64646464, 0x00000005,
];
const PUBLIC_V4 = [0x08080808, 0x01010101, 0x5db8d822, 0x2d4f1a01];

const u32 = fc.oneof(
  fc.integer({ min: 0, max: 0xffffffff }),
  fc.constantFrom(...PRIVATE_V4, ...PUBLIC_V4),
  // Zero halves: the spellings where the text rule lost a group to `::`.
  fc.integer({ min: 0, max: 0xffff }),
  fc.integer({ min: 0, max: 0xffff }).map((n) => (n << 16) >>> 0),
);
const dotted = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const hexPair = (n: number) => `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
const group = fc.integer({ min: 0, max: 0xffff }).map((n) => n.toString(16));
const groups = (n: number) => fc.array(group, { minLength: n, maxLength: n });

/** Text shaped like the inputs each old regex keyed on, and like the ones next to them. */
const legacyShaped = fc.oneof(
  u32.map(dotted),
  u32.map((n) => `::ffff:${dotted(n)}`),
  u32.map((n) => `::ffff:${hexPair(n)}`),
  u32.map((n) => `::ffff:0:${hexPair(n)}`),
  u32.map((n) => `::${dotted(n)}`),
  u32.map((n) => `::${hexPair(n)}`),
  u32.map((n) => `64:ff9b::${hexPair(n)}`),
  u32.map((n) => `64:ff9b::${dotted(n)}`),
  u32.map((n) => `64:ff9b:1::${hexPair(n)}`),
  fc.tuple(u32, groups(1)).map(([n, g]) => `2002:${hexPair(n)}::${g[0]}`),
  fc.tuple(u32, groups(5)).map(([n, g]) => `2002:${hexPair(n)}:${g.join(':')}`),
  fc.tuple(u32, groups(4)).map(([n, g]) => `2001:0:${g.join(':')}:${hexPair(n)}`),
  // Short first groups: `fc`, `fd1`, `fe9` and their neighbours, read by the old rule as text.
  fc
    .tuple(
      fc.constantFrom('f', 'fc', 'fd', 'fe', 'ff', 'fb', '0f'),
      fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), maxLength: 2 }),
      group,
    )
    .map(([head, more, tail]) => `${head}${more}::${tail}`),
  fc
    .tuple(fc.integer({ min: 0xfb00, max: 0xffff }), groups(7))
    .map(([h, g]) => `${h.toString(16)}:${g.join(':')}`),
  groups(8).map((g) => g.join(':')),
  fc.tuple(groups(3), groups(2)).map(([a, b]) => `${a.join(':')}::${b.join(':')}`),
  fc.constantFrom('::', '::1', '::0', '0::', '0:0:0:0:0:0:0:1', 'fe80::1%eth0', '2606::1%x'),
  fc.string({ maxLength: 12 }),
);

/** Mixed case: the old rule lowercased, the new one reads bytes; both must agree on the verdict. */
const legacyInput = fc
  .tuple(legacyShaped, fc.boolean())
  .map(([text, upper]) => (upper ? text.toUpperCase() : text));

const RUNS_NO_REGRESSION = 50_000;

describe('no regression: nothing the old text rule refused is allowed now', () => {
  it(`holds over ${RUNS_NO_REGRESSION} generated addresses biased to every prefix`, () => {
    let legacyAllowed = 0;
    let legacyRefusedValid = 0;
    fc.assert(
      fc.property(legacyInput, (text) => {
        const legacy = legacyIsPrivateOrReservedIp(text);
        if (!legacy) legacyAllowed++;
        else if (net.isIP(text) !== 0) legacyRefusedValid++;
        if (legacy) expect(isPrivateOrReservedIp(text), text).toBe(true);
      }),
      { numRuns: RUNS_NO_REGRESSION },
    );
    // The generator reaches both verdicts of the old rule on valid addresses, so the property is
    // not satisfied by inputs the old rule refused only for being unreadable.
    expect(legacyAllowed).toBeGreaterThan(RUNS_NO_REGRESSION / 10);
    expect(legacyRefusedValid).toBeGreaterThan(RUNS_NO_REGRESSION / 10);
  });
});

// ---------------------------------------------------------------------------------------------
// Independent truth: the verdict computed from the bytes with BigInt masks. These ranges are
// written out again here from the RFCs, not read from address-ranges.ts, and no text is parsed.
// ---------------------------------------------------------------------------------------------

const V4_REFUSED: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function truthV4(n: number): boolean {
  return V4_REFUSED.some(([base, len]) => n >>> (32 - len) === base >>> (32 - len));
}

const within = (x: bigint, base: bigint, len: number) =>
  x >> BigInt(128 - len) === base >> BigInt(128 - len);
const low32 = (x: bigint) => Number(x & 0xffffffffn);

function truthV6(x: bigint): boolean {
  if (within(x, 0x0000_0000_0000_0000_0000_ffff_0000_0000n, 96)) return truthV4(low32(x));
  if (within(x, 0x0000_0000_0000_0000_ffff_0000_0000_0000n, 96)) return truthV4(low32(x));
  if (within(x, 0x0064_ff9b_0000_0000_0000_0000_0000_0000n, 96)) return truthV4(low32(x));
  if (within(x, 0n, 96)) return truthV4(low32(x));
  if (within(x, 0x2002n << 112n, 16)) return truthV4(Number((x >> 80n) & 0xffffffffn));
  if (within(x, 0x2001_0000n << 96n, 32)) return truthV4(~low32(x) >>> 0);
  if (within(x, 0x2001_0db8n << 96n, 32)) return true;
  if (within(x, 0x2001_0002_0000n << 80n, 48)) return true;
  if (within(x, 0x3fffn << 112n, 20)) return true;
  return !within(x, 0x2n << 124n, 3);
}

/** Prefixes the generator starts from, with their lengths; the rest of the bits are random. */
const V6_STARTS: Array<[bigint, number]> = [
  [0n, 96],
  [0x0000_0000_0000_0000_0000_ffff_0000_0000n, 96],
  [0x0000_0000_0000_0000_ffff_0000_0000_0000n, 96],
  [0x0064_ff9b_0000_0000_0000_0000_0000_0000n, 96],
  [0x0064_ff9b_0001n << 80n, 48],
  [0x2002n << 112n, 16],
  [0x2001_0000n << 96n, 32],
  [0x2001_0db8n << 96n, 32],
  [0x2001_0002_0000n << 80n, 48],
  [0x3fffn << 112n, 16],
  [0x2n << 124n, 3],
  [0xfc00n << 112n, 7],
  [0xfe80n << 112n, 10],
  [0xfec0n << 112n, 10],
  [0xff00n << 112n, 8],
  [0x0100n << 112n, 64],
  [0n, 0],
];
const MASK128 = (1n << 128n) - 1n;

/** Where an IPv4 address is written into the generated bytes, if anywhere. */
type Placement = 'none' | 'low' | 'sixToFour' | 'teredo';

const v6Value = fc
  .record({
    start: fc.constantFrom(...V6_STARTS),
    random: fc.bigInt({ min: 0n, max: MASK128 }),
    zeroed: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    v4: u32,
    placement: fc.constantFrom<Placement>('none', 'low', 'sixToFour', 'teredo'),
  })
  .map(({ start: [base, len], random, zeroed, v4, placement }) => {
    let x = random;
    zeroed.forEach((z, i) => {
      if (z) x &= ~(0xffffn << BigInt(112 - 16 * i)) & MASK128;
    });
    const keep = len === 0 ? 0n : (MASK128 << BigInt(128 - len)) & MASK128;
    x = (x & ~keep & MASK128) | (base & keep);
    const v = BigInt(v4);
    if (placement === 'low') x = (x & ~0xffffffffn) | v;
    if (placement === 'sixToFour') x = (x & ~(0xffffffffn << 80n)) | (v << 80n);
    if (placement === 'teredo') x = (x & ~0xffffffffn) | (~v & 0xffffffffn);
    return x;
  });

/** Each way of writing eight groups: `::` over any run of zero groups or none, with or without a dotted tail. */
function spellings(x: bigint, upper: boolean[], pad: number[]): string[] {
  const g = Array.from({ length: 8 }, (_, i) => Number((x >> BigInt(112 - 16 * i)) & 0xffffn));
  const word = (i: number) => {
    const digits = g[i]!.toString(16).padStart(pad[i]!, '0');
    return upper[i] ? digits.toUpperCase() : digits;
  };
  const tail = dotted(low32(x));
  const out: string[] = [];
  const write = (from: number, to: number, dottedTail: boolean): string => {
    const end = dottedTail ? 6 : 8;
    const part = (a: number, b: number) =>
      Array.from({ length: Math.max(0, b - a) }, (_, k) => word(a + k));
    const tailText = dottedTail ? [tail] : [];
    if (from === to) return [...part(0, end), ...tailText].join(':');
    const left = part(0, from).join(':');
    const right = [...part(to, end), ...tailText].join(':');
    return `${left}::${right}`;
  };
  for (const dottedTail of [false, true]) {
    const end = dottedTail ? 6 : 8;
    out.push(write(0, 0, dottedTail));
    for (let from = 0; from < end; from++) {
      for (let to = from + 1; to <= end && g[to - 1] === 0; to++)
        out.push(write(from, to, dottedTail));
    }
  }
  return out;
}

const RUNS_TRUTH = 5_000;

describe('independent truth: the verdict equals the one computed from the bytes', () => {
  it(`holds for IPv6 over ${RUNS_TRUTH} generated byte strings, each in every spelling`, () => {
    let spelled = 0;
    const verdicts = { refused: 0, allowed: 0 };
    fc.assert(
      fc.property(
        v6Value,
        fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 8, maxLength: 8 }),
        (x, upper, pad) => {
          const expected = truthV6(x);
          verdicts[expected ? 'refused' : 'allowed']++;
          for (const text of spellings(x, upper, pad)) {
            spelled++;
            expect(net.isIP(text), text).toBe(6);
            expect(isPrivateOrReservedIp(text), text).toBe(expected);
          }
        },
      ),
      { numRuns: RUNS_TRUTH },
    );
    expect(spelled).toBeGreaterThan(RUNS_TRUTH * 2);
    // Both verdicts are reached, so the property is not met by a generator that lands in one row.
    expect(verdicts.refused).toBeGreaterThan(RUNS_TRUTH / 10);
    expect(verdicts.allowed).toBeGreaterThan(RUNS_TRUTH / 10);
  });

  it(`holds for IPv4 over ${RUNS_TRUTH} generated addresses`, () => {
    const v4 = fc.oneof(
      u32,
      fc
        .tuple(
          fc.constantFrom(...V4_REFUSED),
          fc.integer({ min: 0, max: 0xffffffff }),
          fc.integer({ min: -1, max: 1 }),
        )
        .map(([[base, len], bits, edge]) => {
          // Inside the range, or one address past either end of it.
          const size = 2 ** (32 - len);
          const inside = (base + (bits % size)) >>> 0;
          if (edge === -1) return (base - 1) >>> 0;
          if (edge === 1) return (base + size) >>> 0;
          return inside;
        }),
    );
    fc.assert(
      fc.property(v4, (n) => {
        expect(isPrivateOrReservedIp(dotted(n)), dotted(n)).toBe(truthV4(n));
      }),
      { numRuns: RUNS_TRUTH },
    );
  });

  it('the truth itself is right at hand-checked vectors', () => {
    expect(truthV6(0x0064_ff9b_0000_0000_0000_0000_0000_0005n)).toBe(true);
    expect(truthV6(0x0064_ff9b_0000_0000_0000_0000_0808_0808n)).toBe(false);
    expect(truthV6(0x2001_0000_4136_e378_8000_63bf_80ff_fffen)).toBe(true);
    expect(truthV6(0x2001_0000_4136_e378_8000_63bf_f7f7_f7f7n)).toBe(false);
    expect(truthV6(0x2606_4700_4700_0000_0000_0000_0000_1111n)).toBe(false);
    expect(truthV6(0x00fc_0000_0000_0000_0000_0000_0000_0001n)).toBe(true);
    expect(truthV4(0xffffffff)).toBe(true);
    expect(truthV4(0x08080808)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The guard refuses when Node does not read the text as an address or when the parser does not.
// This property measures whether the two ever disagree on text without a zone.
// ---------------------------------------------------------------------------------------------

const RUNS_AGREEMENT = 50_000;

describe('the parser and net.isIP accept the same text', () => {
  it(`agree over ${RUNS_AGREEMENT} near-addresses without a zone`, () => {
    const edit = fc.tuple(
      fc.nat(),
      fc.constantFrom(':', '.', '0', '1', '9', 'a', 'F', 'g', '00', '::', '', ' ', '255', '256'),
      fc.integer({ min: 0, max: 2 }),
    );
    const nearAddress = fc
      .tuple(
        fc.oneof(
          legacyShaped,
          v6Value.map((x) => spellings(x, Array(8).fill(false), Array(8).fill(1))[0]!),
        ),
        fc.array(edit, { maxLength: 3 }),
      )
      .map(([text, edits]) =>
        edits.reduce((t, [at, insert, drop]) => {
          const i = t.length === 0 ? 0 : at % (t.length + 1);
          return t.slice(0, i) + insert + t.slice(i + drop);
        }, text),
      )
      .filter((text) => !text.includes('%'));
    fc.assert(
      fc.property(nearAddress, (text) => {
        expect(parseAddress(text) !== null, JSON.stringify(text)).toBe(net.isIP(text) !== 0);
      }),
      { numRuns: RUNS_AGREEMENT },
    );
  });
});
