/**
 * Whether a URL may be sent to Browser Run as a page to render. Admission is a parameter of the render,
 * so the caller can pass the project's URL admission once it exists (CC-SEC-01); this is the default.
 *
 * The default refuses what the request policy refuses (policy.ts), since Browser Run would block that
 * navigation anyway, and then resolves the host and refuses a private or reserved address
 * (`validateUrlOrThrow`). The resolution happens in our process; the browser resolves the name again on
 * Cloudflare, possibly to another address. So this is a defence, not a guarantee.
 */
import { validateUrlOrThrow, type DnsResolver } from '../../ssrf-guard.js';
import { refusingRule } from './policy.js';

export type Admit = (url: string) => Promise<void>;

export class NotAdmitted extends Error {
  constructor(
    /** The policy rule that refused the URL, `unparseable`, or `resolution`. */
    readonly rule: string,
  ) {
    super(`not admitted for rendering: ${rule}`);
    this.name = 'NotAdmitted';
  }
}

export function defaultAdmit(resolver?: DnsResolver): Admit {
  return async (raw) => {
    let href: string;
    try {
      href = new URL(raw).href;
    } catch {
      throw new NotAdmitted('unparseable');
    }
    const rule = refusingRule(href);
    if (rule) throw new NotAdmitted(rule.name);
    try {
      await validateUrlOrThrow(href, resolver ? { resolver } : {});
    } catch {
      throw new NotAdmitted('resolution');
    }
  };
}
