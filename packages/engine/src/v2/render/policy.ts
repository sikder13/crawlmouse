/**
 * What the browser may request while it renders a page.
 *
 * Browser Run's REST `/content` endpoint runs the browser on Cloudflare, so our code is not asked about
 * each request the page makes. What we can do is send two lists with every render, which Cloudflare
 * enforces: resource types to refuse, and URL patterns to refuse. Sub-requests are filtered by these
 * patterns, not by a check that runs in our process. The navigation URL itself is checked in our
 * process too (admission.ts), against these same patterns and a DNS resolution.
 *
 * WHY HOSTS ARE A REJECT-LIST, NOT AN ALLOW-LIST. `text_share` is static words over rendered words. A
 * script the browser is not allowed to load cannot add words, so every script blocked by mistake makes
 * the rendered side smaller and the share larger: a page that needs JavaScript reads as one that does
 * not. An allow-list of script origins does exactly that to every site whose own JavaScript is served
 * from a CDN under another name (a Shopify store, a site on CloudFront). So only hosts whose scripts are
 * not the page's content are refused: advertising, analytics, consent banners and chat widgets.
 */

/** Resource types refused on both sides: they add no text, and WebSocket and eventsource stay open. */
export const REJECTED_RESOURCE_TYPES = ['websocket', 'eventsource', 'media'] as const;

/** The static side also refuses scripts, so it shows what a reader that runs no JavaScript gets. */
export const STATIC_REJECTED_RESOURCE_TYPES = [...REJECTED_RESOURCE_TYPES, 'script'] as const;

export interface HostList {
  name: string;
  hosts: readonly string[];
}

/**
 * Hosts whose requests are refused, with every subdomain of each. Hand-compiled on 2026-11-05 from the
 * hosts each vendor's standard embed snippet loads from; not taken from a maintained block list. A
 * vendor missing here is loaded like any other script.
 */
export const REJECTED_HOSTS_AS_OF = '2026-11-05';
export const REJECTED_HOSTS: readonly HostList[] = [
  {
    name: 'advertising',
    hosts: [
      'doubleclick.net',
      'googlesyndication.com',
      'googleadservices.com',
      'amazon-adsystem.com',
      'adnxs.com',
      'criteo.com',
      'criteo.net',
      'taboola.com',
      'outbrain.com',
      'pubmatic.com',
      'rubiconproject.com',
      'static.ads-twitter.com',
    ],
  },
  {
    name: 'analytics',
    hosts: [
      'google-analytics.com',
      'googletagmanager.com',
      'connect.facebook.net',
      'bat.bing.com',
      'clarity.ms',
      'hotjar.com',
      'cdn.segment.com',
      'mixpanel.com',
      'cdn.amplitude.com',
      'fullstory.com',
      'heapanalytics.com',
      'js-agent.newrelic.com',
      'plausible.io',
    ],
  },
  {
    name: 'consent',
    hosts: [
      'cookielaw.org',
      'onetrust.com',
      'cookiebot.com',
      'consentmanager.net',
      'usercentrics.eu',
      'trustarc.com',
      'privacy-center.org',
      'iubenda.com',
      'cookieyes.com',
      'termly.io',
    ],
  },
  {
    name: 'chat',
    hosts: [
      'intercom.io',
      'intercomcdn.com',
      'driftt.com',
      'zdassets.com',
      'zopim.com',
      'crisp.chat',
      'tawk.to',
      'livechatinc.com',
      'usemessages.com',
      'tidio.co',
      'olark.com',
    ],
  },
];

/** Archive and installer endings: a request for a path ending in one is a download, not a page. */
export const DOWNLOAD_EXTENSIONS = [
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  'exe',
  'msi',
  'dmg',
  'pkg',
  'deb',
  'rpm',
  'apk',
  'iso',
] as const;

/**
 * Host names that are never a public website (SECURITY-DESIGN §2.3.1 step 4): `localhost` and anything
 * under these suffixes, and any name of a single label.
 */
export const RESERVED_NAME_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'home.arpa',
  'onion',
  'i2p',
];

export interface UrlRule {
  name: string;
  /** What the rule refuses, as the spec prints it. */
  refuses: string;
  pattern: RegExp;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The patterns are written for URLs as the browser hands them over: scheme and host in lower case,
 * IP addresses in their canonical form, a default port dropped. `/` cannot occur in a host, so
 * `[^/?#]*` stays inside the authority.
 */
const HOST_END = '(?::[0-9]*)?(?:[/?#]|$)';

function hostRule(list: HostList): UrlRule {
  return {
    name: `host_${list.name}`,
    refuses: `${list.name} hosts and their subdomains`,
    pattern: new RegExp(
      `^https?://(?:[^/?#@]*\\.)?(?:${list.hosts.map(escape).join('|')})${HOST_END}`,
    ),
  };
}

export const URL_RULES: readonly UrlRule[] = [
  {
    name: 'scheme',
    refuses: 'any scheme but http, https, data and blob (file:, ws:, wss:, chrome: and the rest)',
    pattern: /^(?!(?:https?|data|blob):)/,
  },
  {
    name: 'credentials',
    refuses: 'a user name or password in the URL',
    pattern: /^https?:\/\/[^/?#]*@/,
  },
  {
    name: 'ip_literal',
    refuses: 'an IP address in place of a host name, IPv4 or bracketed IPv6',
    pattern: new RegExp(`^https?://(?:\\[[^\\]]*\\]|[0-9.]+|0x[0-9a-f.x]*)${HOST_END}`),
  },
  {
    name: 'port',
    refuses: 'a port other than 80 and 443',
    pattern: /^https?:\/\/[^/?#]*:(?!(?:80|443)(?:[/?#]|$))[0-9]*(?:[/?#]|$)/,
  },
  {
    name: 'reserved_name',
    refuses: `a single-label host, \`localhost\`, or a name under ${RESERVED_NAME_SUFFIXES.map((s) => `\`.${s}\``).join(', ')}`,
    pattern: new RegExp(
      `^https?://(?:[^/?#.@:]+|[^/?#@:]*\\.(?:${RESERVED_NAME_SUFFIXES.map(escape).join('|')}))\\.?${HOST_END}`,
    ),
  },
  {
    name: 'download',
    refuses: `a path ending in ${DOWNLOAD_EXTENSIONS.map((e) => `\`.${e}\``).join(', ')}`,
    pattern: new RegExp(
      `^https?://[^/?#]*/[^?#]*\\.(?:${DOWNLOAD_EXTENSIONS.join('|')})(?:[?#]|$)`,
    ),
  },
  ...REJECTED_HOSTS.map(hostRule),
];

/** A pattern as Browser Run reads it: the regular expression between slashes. */
export const wirePattern = (re: RegExp): string => `/${re.source}/`;

/** The first rule that refuses `href` (a URL as the browser would request it), or null. */
export function refusingRule(href: string): UrlRule | null {
  return URL_RULES.find((r) => r.pattern.test(href)) ?? null;
}
