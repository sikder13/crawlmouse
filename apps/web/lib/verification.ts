import 'server-only';
import { promises as dns } from 'node:dns';
import { safeFetch } from '@crawlmouse/engine';

export async function checkDnsTxtRecord(domain: string, expectedToken: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(`_crawlmouse.${domain}`);
    const flat = records.map((r) => r.join('')).map((s) => s.trim());
    return flat.some((s) => s === `crawlmouse-verify=${expectedToken}`);
  } catch { return false; }
}

export async function checkMetaTag(domain: string, expectedToken: string): Promise<boolean> {
  const url = `https://${domain}/`;
  try {
    // safeFetch validates + IP-pins every hop (no validate-then-fetch DNS-rebinding window),
    // re-validates redirect targets, and caps the body — the raw fetch this replaced did none
    // of that, so a user-chosen domain could rebind to an internal/metadata IP.
    const res = await safeFetch(url, { userAgent: 'CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)' });
    if (res.status < 200 || res.status >= 300) return false;
    const re = /<meta\s+name=["']crawlmouse-verification["']\s+content=["']([^"']+)["']/i;
    const match = res.body.match(re);
    return match?.[1] === expectedToken;
  } catch { return false; }
}
