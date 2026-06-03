import { NextResponse } from 'next/server';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processTakedown } from '@/lib/takedown';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { ADMIN_TAKEDOWN_PER_IP_PER_HOUR } from '@/lib/limits';

export const runtime = 'nodejs';

const HOUR_MS = 60 * 60 * 1000;
const schema = z.object({ slug: z.string().min(1).max(64) });

function authorized(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false; // closed by default — no secret set means no admin access
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  // The length check is load-bearing: timingSafeEqual throws on unequal-length buffers, so it
  // MUST short-circuit before the compare. (Reordering it would crash on every wrong-length token.)
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!authorized(req)) {
    // Audit trail: a report-darkening endpoint should record rejected attempts (no secret leaked).
    console.error(`[admin:takedown] unauthorized attempt from ip=${ip}`);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Defense-in-depth throttle (the long random ADMIN_SECRET is the primary control): caps a
  // brute-force / runaway against a misconfigured short secret. Mirrors /api/takedown's pattern.
  if (ip !== 'unknown') {
    const rl = await checkRateLimit(`admin-takedown:ip:${ip}`, ADMIN_TAKEDOWN_PER_IP_PER_HOUR, HOUR_MS);
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  try {
    await processTakedown(supabaseAdmin(), parsed.data.slug);
  } catch {
    return NextResponse.json({ error: 'could not process' }, { status: 500 });
  }
  // Audit trail for the actioned takedown (who/when is captured by the platform log timestamp + ip).
  console.log(`[admin:takedown] actioned slug=${parsed.data.slug} ip=${ip}`);
  return NextResponse.json({ ok: true });
}
