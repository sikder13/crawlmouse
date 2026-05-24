import 'server-only';
import { promises as dns } from 'node:dns';
import { validateUrlOrThrow } from '@crawlmouse/engine';

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
    await validateUrlOrThrow(url);
    const res = await fetch(url, { headers: { 'User-Agent': 'CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)' } });
    if (!res.ok) return false;
    const html = await res.text();
    const re = /<meta\s+name=["']crawlmouse-verification["']\s+content=["']([^"']+)["']/i;
    const match = html.match(re);
    return match?.[1] === expectedToken;
  } catch { return false; }
}
