/**
 * The address typed on Home, checked before an audit would start: a public domain name, with or
 * without a scheme and path. The server checks again (and its SSRF guard decides what may be
 * fetched); this only saves the visitor a round trip and says what to fix.
 */

export type HostCheck =
  | { ok: true; host: string }
  | { ok: false; reason: 'empty' | 'scheme' | 'ip' | 'invalid'; message: string };

const MESSAGES = {
  empty: "Enter your site's address, like yourdomain.com.",
  scheme: 'Enter a web address: the domain on its own, or one starting with http:// or https://.',
  ip: "Enter the site's domain name rather than an IP address.",
  invalid: "That doesn't look like a public web address. Try something like yourdomain.com.",
} as const;

const fail = (reason: keyof typeof MESSAGES): HostCheck => ({
  ok: false,
  reason,
  message: MESSAGES[reason],
});

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function checkHost(input: string): HostCheck {
  const raw = input.trim();
  if (!raw) return fail('empty');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  const hasAuthority = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (scheme && hasAuthority && !/^https?$/i.test(scheme[1]!)) return fail('scheme');
  if (scheme && !hasAuthority && !/^[^:/]+:\d+(?:\/|$)/.test(raw)) return fail('scheme');
  if (/\s/.test(raw)) return fail('invalid');
  let host: string;
  try {
    host = new URL(hasAuthority ? raw : `https://${raw}`).hostname;
  } catch {
    return fail('invalid');
  }
  if (host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return fail('ip');
  host = host.replace(/\.$/, '');
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2) return fail('invalid');
  if (!labels.every((l) => LABEL.test(l)) || !TLD.test(labels.at(-1)!)) return fail('invalid');
  return { ok: true, host };
}
