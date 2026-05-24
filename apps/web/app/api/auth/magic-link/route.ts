import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { z } from 'zod';

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const sb = await supabaseServer();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const { error } = await sb.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${baseUrl}/login/verify`,
    },
  });

  if (error) {
    return NextResponse.json({ error: 'Could not send magic link' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
