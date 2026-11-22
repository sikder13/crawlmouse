import { baseUrlOf } from './lib/target';
import { bypassSecret, originHeaders, protectionRefusal } from './lib/protection';

/**
 * Before any step: probe the deployment once, so a protected deployment stops the run with its reason
 * instead of failing every step against Vercel's sign-in page. A placeholder base URL (the CI run of the
 * pure specs) has no deployment to probe.
 */
export default async function globalSetup(): Promise<void> {
  const base = baseUrlOf(process.env);
  if (base.hostname.endsWith('.invalid')) return;
  const res = await fetch(new URL('/api/health', base), {
    headers: originHeaders(process.env),
    redirect: 'manual',
  });
  const headers = Object.fromEntries(res.headers.entries());
  const refused = protectionRefusal(res.status, headers, bypassSecret(process.env) !== null);
  if (refused) throw new Error(refused);
}
