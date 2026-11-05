/**
 * What the browser may request while it renders a page.
 *
 * Browser Run's REST `/content` endpoint runs the browser on Cloudflare, so our code is not asked about
 * each request the page makes. What we can do is send two lists with every render for Browser Run to
 * apply, as its documentation describes: resource types to refuse, and URL patterns to refuse. By
 * design, sub-requests are filtered by these patterns and not by a check in our process; whether
 * Browser Run applies them is what live.test.ts shows. The navigation URL itself is also checked in
 * our process (admission.ts), against these same patterns and a DNS resolution.
 *
 * WHY HOSTS ARE A REJECT-LIST, NOT AN ALLOW-LIST. `text_share` is static words over rendered words. A
 * script the browser is not allowed to load cannot add words, so a script blocked by mistake that
 * would have written text makes the rendered side smaller and the share larger. An allow-list of
 * script origins does that to sites whose own JavaScript is served from a CDN under another name (a
 * Shopify store, a site on CloudFront). So the hosts refused are those whose scripts are usually not
 * the page's content: advertising, analytics, consent banners and chat widgets.
 */

/**
 * Resource types refused on both sides: media adds no text, and WebSocket and eventsource are long-lived
 * connections a measurement of the page does not need. A page whose text arrives over one loses that
 * text on the rendered side.
 */
export const REJECTED_RESOURCE_TYPES = ['websocket', 'eventsource', 'media'] as const;

/**
 * The static side also refuses the `script` resource type, so script files do not load on it. A script
 * written inline in the HTML is not a request and still runs.
 */
export const STATIC_REJECTED_RESOURCE_TYPES = [...REJECTED_RESOURCE_TYPES, 'script'] as const;

export interface HostList {
  name: string;
  hosts: readonly string[];
}

/**
 * Hosts whose requests are refused, with every subdomain of each. Hand-compiled on 2026-11-05 from
 * what was known of each vendor's embed snippet, not fetched from the vendors and not taken from a
 * maintained block list, so it misses hosts. A host missing here loads like any other script. A host
 * here can also serve something that is content (a tag manager can inject text); its words are then
 * missing from the rendered side, which raises the share.
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
      'mxpnl.com',
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
      'cdn-cookieyes.com',
      'termly.io',
    ],
  },
  {
    name: 'chat',
    hosts: [
      'intercom.io',
      'intercomcdn.com',
      'driftt.com',
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

/** `zip` as `[zZ][iI][pP]`: a pattern that matches in any case without relying on a flag. */
const anyCase = (s: string) =>
  [...s].map((c) => (/[a-z]/.test(c) ? `[${c}${c.toUpperCase()}]` : c)).join('');

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
      `^https?://(?:[^/?#@]*\\.)?(?:${list.hosts.map(escape).join('|')})\\.?${HOST_END}`,
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
    pattern: new RegExp(`^https?://(?:\\[[^\\]]*\\]|[0-9.]+)${HOST_END}`),
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
      `^https?://[^/?#]*/[^?#]*\\.(?:${DOWNLOAD_EXTENSIONS.map(anyCase).join('|')})(?:[?#]|$)`,
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
