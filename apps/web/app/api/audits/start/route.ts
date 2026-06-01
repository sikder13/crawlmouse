import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateUrlOrThrow } from '@crawlmouse/engine';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest';
import { checkRateLimit } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { userIsPro } from '@/lib/pro';
import { tierLimits } from '@/lib/tier';
import { AUDIT_TTL_DAYS } from '@/lib/limits';

const schema = z.object({
  url: z.string().url(),
  turnstileToken: z.string().optional(),
});

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  try {
    await validateUrlOrThrow(parsed.data.url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid URL' }, { status: 400 });
  }

  const ip = getClientIp(req);
  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  const sb = supabaseAdmin();

  const domain = new URL(parsed.data.url).hostname;
  const domainCheck = await checkRateLimit(`domain:${domain}`, 1, HOUR_MS);
  if (!domainCheck.allowed) {
    return NextResponse.json({ error: 'Another audit for this domain ran in the last hour. Try again soon.' }, { status: 429 });
  }

  const ipLimit = user ? 5 : 3;
  const ipCheck = await checkRateLimit(`ip:${ip}`, ipLimit, TWENTY_FOUR_HOURS_MS);
  if (!ipCheck.allowed) {
    if (!parsed.data.turnstileToken) {
      return NextResponse.json({ error: 'captcha_required', resetAt: ipCheck.resetAt }, { status: 429 });
    }
    const ok = await verifyTurnstileToken(parsed.data.turnstileToken, ip);
    if (!ok) return NextResponse.json({ error: 'Captcha failed' }, { status: 429 });
  }

  const proUser = user ? await userIsPro(sbUser, user.id) : false;
  const { pageCap, perHostConcurrency } = tierLimits(proUser);
  const expiresAt = proUser ? null : new Date(Date.now() + AUDIT_TTL_DAYS * TWENTY_FOUR_HOURS_MS).toISOString();

  const { data: audit, error: insertError } = await sb
    .from('audits')
    .insert({
      user_id: user?.id ?? null,
      anonymous_session_id: user ? null : `anon-${ip}-${Date.now()}`,
      url: parsed.data.url,
      status: 'pending',
      settings: { pageCap },
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insertError || !audit) {
    return NextResponse.json({ error: 'Could not create audit' }, { status: 500 });
  }

  await inngest.send({
    name: 'audit.requested',
    data: { auditId: audit.id, url: parsed.data.url, pageCap, perHostConcurrency },
  });

  return NextResponse.json({ auditId: audit.id });
}
