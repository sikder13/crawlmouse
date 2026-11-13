/**
 * IP address text read into bytes, and the table of ranges the fetch guard refuses.
 *
 * The guard (ssrf-guard.ts) decides on the 4 or 16 bytes of an address, never on how it is
 * written, so `0:0:0:0:0:ffff:a00:1`, `::FFFF:10.0.0.1` and `::ffff:a00:1` get one verdict.
 */

export interface ParsedAddress {
  readonly family: 4 | 6;
  readonly bytes: Uint8Array;
  /** The text after `%` in an IPv6 address, or null when it has none. */
  readonly zone: string | null;
}

const DECIMAL_OCTET = /^(0|[1-9]\d{0,2})$/;
const HEX_GROUP = /^[0-9a-fA-F]{1,4}$/;

function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i]!;
    if (!DECIMAL_OCTET.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

function parseGroups(text: string): number[] | null {
  if (text === '') return [];
  const groups: number[] = [];
  for (const group of text.split(':')) {
    if (!HEX_GROUP.test(group)) return null;
    groups.push(parseInt(group, 16));
  }
  return groups;
}

function parseIpv6(text: string): Uint8Array | null {
  // A dotted IPv4 tail stands for the last two groups.
  let hex = text;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    const high = ((v4[0]! << 8) | v4[1]!).toString(16);
    const low = ((v4[2]! << 8) | v4[3]!).toString(16);
    hex = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = hex.split('::');
  let groups: number[];
  if (halves.length === 1) {
    const all = parseGroups(hex);
    if (all === null || all.length !== 8) return null;
    groups = all;
  } else if (halves.length === 2) {
    const left = parseGroups(halves[0]!);
    const right = parseGroups(halves[1]!);
    // `::` stands for at least one group of zeros.
    if (left === null || right === null || left.length + right.length > 7) return null;
    groups = [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
  } else {
    return null;
  }

  const bytes = new Uint8Array(16);
  groups.forEach((group, i) => {
    bytes[2 * i] = group >> 8;
    bytes[2 * i + 1] = group & 0xff;
  });
  return bytes;
}

/**
 * Reads an IPv4 address in dotted decimal (four parts, 0 to 255, no leading zeros) or an IPv6
 * address (one to four hex digits a group, any case, at most one `::`, an optional dotted IPv4
 * tail, an optional `%zone`). Returns null for anything else.
 */
export function parseAddress(text: string): ParsedAddress | null {
  if (!text.includes(':')) {
    const bytes = parseIpv4(text);
    return bytes === null ? null : { family: 4, bytes, zone: null };
  }
  const percent = text.indexOf('%');
  const zone = percent === -1 ? null : text.slice(percent + 1);
  const bytes = parseIpv6(percent === -1 ? text : text.slice(0, percent));
  return bytes === null ? null : { family: 6, bytes, zone };
}

export interface AddressRange {
  readonly cidr: string;
  /** Where the range is defined. */
  readonly source: string;
  readonly purpose: string;
  readonly family: 4 | 6;
  readonly prefix: Uint8Array;
  readonly length: number;
  /** `inside` matches the addresses in the prefix; `outside` matches the ones not in it. */
  readonly match: 'inside' | 'outside';
  /** Set on a row that carries an IPv4 address: it returns those 4 bytes, and the IPv4 rows decide. */
  readonly embeddedIpv4?: (bytes: Uint8Array) => Uint8Array;
}

function range(
  cidr: string,
  source: string,
  purpose: string,
  shape: Pick<AddressRange, 'match' | 'embeddedIpv4'> = { match: 'inside' },
): AddressRange {
  const [text, bits] = cidr.split('/');
  const parsed = parseAddress(text!);
  if (parsed === null || bits === undefined) throw new Error(`Bad range in the table: ${cidr}`);
  return {
    cidr,
    source,
    purpose,
    family: parsed.family,
    prefix: parsed.bytes,
    length: Number(bits),
    ...shape,
  };
}

const lastFour = (bytes: Uint8Array) => bytes.slice(12, 16);
const sixToFour = (bytes: Uint8Array) => bytes.slice(2, 6);
const teredoClient = (bytes: Uint8Array) => bytes.slice(12, 16).map((b) => b ^ 0xff);
const embeds = (embeddedIpv4: (bytes: Uint8Array) => Uint8Array) => ({
  match: 'inside' as const,
  embeddedIpv4,
});

/**
 * One row per range. The first row whose family and prefix match the address decides: a plain row
 * refuses, and a row with `embeddedIpv4` gives the verdict of the IPv4 rows on the address it carries.
 *
 * Order rule: no two `inside` rows overlap, so their order does not change any verdict. The one
 * `outside` row is last, and four rows before it lie outside 2000::/3 (::ffff:0:0/96,
 * ::ffff:0:0:0/96, 64:ff9b::/96 and ::/96), so they are read for an embedded address before the
 * last row would refuse them. address-ranges.test.ts checks both halves of this rule.
 *
 * Each IPv4 row except 224.0.0.0/4 is a block of the IANA IPv4 Special-Purpose Address Registry;
 * multicast has a registry of its own. The IPv6 rows other than the last are blocks of the IANA IPv6
 * Special-Purpose Address Registry, apart from ::/96 and ::ffff:0:0:0/96, which are cited to their RFCs.
 */
export const ADDRESS_RANGES: readonly AddressRange[] = [
  range('0.0.0.0/8', 'RFC 791 §3.2', '"this network", holds 0.0.0.0'),
  range('10.0.0.0/8', 'RFC 1918', 'private use'),
  range(
    '100.64.0.0/10',
    'RFC 6598',
    'shared address space (carrier-grade NAT), holds 100.100.100.200',
  ),
  range('127.0.0.0/8', 'RFC 1122 §3.2.1.3', 'loopback'),
  range(
    '169.254.0.0/16',
    'RFC 3927',
    'link local, holds the cloud metadata address 169.254.169.254',
  ),
  range('172.16.0.0/12', 'RFC 1918', 'private use'),
  range('192.0.0.0/24', 'RFC 6890 §2.1', 'IETF protocol assignments'),
  range('192.0.2.0/24', 'RFC 5737', 'documentation (TEST-NET-1)'),
  range('192.168.0.0/16', 'RFC 1918', 'private use'),
  range('198.18.0.0/15', 'RFC 2544', 'benchmarking'),
  range('198.51.100.0/24', 'RFC 5737', 'documentation (TEST-NET-2)'),
  range('203.0.113.0/24', 'RFC 5737', 'documentation (TEST-NET-3)'),
  range('224.0.0.0/4', 'RFC 5771', 'multicast'),
  range(
    '240.0.0.0/4',
    'RFC 1112 §4 (reserved); RFC 919 §7 and RFC 8190 (limited broadcast)',
    'reserved, holds the limited broadcast address 255.255.255.255',
  ),

  range('::ffff:0:0/96', 'RFC 4291 §2.5.5.2', 'IPv4-mapped', embeds(lastFour)),
  range(
    '::ffff:0:0:0/96',
    'RFC 2765 §2.1 (obsoleted by RFC 6145)',
    'IPv4-translated',
    embeds(lastFour),
  ),
  range('64:ff9b::/96', 'RFC 6052 §2.1', 'NAT64 well-known prefix', embeds(lastFour)),
  range(
    '::/96',
    'RFC 4291 §2.5.5.1',
    'IPv4-compatible (deprecated); :: and ::1 carry 0.0.0.0 and 0.0.0.1',
    embeds(lastFour),
  ),
  range('2002::/16', 'RFC 3056 §2', '6to4, the IPv4 address in bytes 2 to 5', embeds(sixToFour)),
  range(
    '2001::/32',
    'RFC 4380 §4',
    'Teredo, the client address in bytes 12 to 15 with every bit inverted',
    embeds(teredoClient),
  ),
  range('2001:db8::/32', 'RFC 3849', 'documentation'),
  range('2001:2::/48', 'RFC 5180', 'benchmarking'),
  range('3fff::/20', 'RFC 9637', 'documentation'),
  range(
    '2000::/3',
    'IANA IPv6 Address Space registry; RFC 3587',
    'not global unicast: loopback, unspecified, link local, unique local, site local, multicast, 100::/64, 64:ff9b:1::/48 and the reserved space',
    { match: 'outside' },
  ),
];

function inPrefix(bytes: Uint8Array, row: AddressRange): boolean {
  const whole = row.length >> 3;
  for (let i = 0; i < whole; i++) if (bytes[i] !== row.prefix[i]) return false;
  const rest = row.length & 7;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return (bytes[whole]! & mask) === (row.prefix[whole]! & mask);
}

/** The first row that matches, or undefined for an address no row covers. */
export function rangeOf(family: 4 | 6, bytes: Uint8Array): AddressRange | undefined {
  return ADDRESS_RANGES.find(
    (row) => row.family === family && inPrefix(bytes, row) === (row.match === 'inside'),
  );
}

/** True when the table refuses the address, reading through the rows that carry an IPv4 address. */
export function isReservedAddress(family: 4 | 6, bytes: Uint8Array): boolean {
  const row = rangeOf(family, bytes);
  if (row === undefined) return false;
  if (row.embeddedIpv4 === undefined) return true;
  return rangeOf(4, row.embeddedIpv4(bytes)) !== undefined;
}
