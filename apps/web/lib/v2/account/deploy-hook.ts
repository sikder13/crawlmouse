/**
 * A staging site's deploy hook (Goal 1 row 20, F-097): an address that queues a check of that site
 * when a deploy calls it. The address carries the site's id and a signature, an HMAC of the id and
 * the site's `created_at` under `DEPLOY_HOOK_SECRET`. Nothing is stored. Removing the staging site and
 * adding it again changes `created_at`, and with it the address, which is how a leaked one is
 * replaced.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

type Env = Readonly<Record<string, string | undefined>>;

/** The signature's length in base64url characters: 192 bits. */
const SIGNATURE_LENGTH = 32;
/** A secret shorter than this is treated as unset, so a placeholder cannot sign anything. */
const SECRET_MIN = 32;

const HOOK =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{32})$/;

/** The secret, or null when it is unset or too short to sign with. */
export function deployHookSecret(env: Env = process.env): string | null {
  const s = env.DEPLOY_HOOK_SECRET?.trim();
  return s && s.length >= SECRET_MIN ? s : null;
}

/** The signature for a site, from its id and its `created_at` read back as an instant. */
export function deployHookSignature(siteId: string, createdAt: string, secret: string): string {
  const at = new Date(createdAt).toISOString();
  return createHmac('sha256', secret)
    .update(`deploy-hook:${siteId}:${at}`)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

/** The path a deploy posts to. */
export function deployHookPath(siteId: string, createdAt: string, secret: string): string {
  return `/api/hooks/deploy/${siteId}.${deployHookSignature(siteId, createdAt, secret)}`;
}

/** The site id and signature an address holds, or null for one that is not a hook's shape. */
export function parseDeployHook(param: string): { siteId: string; signature: string } | null {
  const m = HOOK.exec(param);
  return m ? { siteId: m[1]!, signature: m[2]! } : null;
}

/** Whether `signature` is the site's, compared in constant time. */
export function verifyDeployHook(
  signature: string,
  siteId: string,
  createdAt: string,
  secret: string,
): boolean {
  const want = Buffer.from(deployHookSignature(siteId, createdAt, secret));
  const got = Buffer.from(signature);
  return got.length === want.length && timingSafeEqual(got, want);
}
