import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cookieMethodsFor } from './cookie-methods';

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethodsFor(cookieStore) },
  );
}
