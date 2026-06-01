'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function VerifyPage() {
  const router = useRouter();
  useEffect(() => {
    const sb = supabaseBrowser();
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN') {
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
