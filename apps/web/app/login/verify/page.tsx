'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function VerifyPage() {
  const router = useRouter();
  const handled = useRef(false);
  useEffect(() => {
    const sb = supabaseBrowser();
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (event) => {
      // onAuthStateChange can emit SIGNED_IN more than once; claim + redirect exactly once.
      if (event === 'SIGNED_IN' && !handled.current) {
        handled.current = true;
        // Claim any audits this browser ran anonymously before redirecting.
        await fetch('/api/auth/claim', { method: 'POST' }).catch(() => {});
        router.replace('/dashboard');
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);
  return (
    <main className="min-h-screen bg-cream flex items-center justify-center p-8">
      <div className="text-center">
        <div className="font-display text-2xl">Signing you in...</div>
      </div>
    </main>
  );
}
