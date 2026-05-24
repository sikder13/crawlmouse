'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function VerifyPage() {
  const router = useRouter();
  useEffect(() => {
    const sb = supabaseBrowser();
    const { data: { subscription } } = sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') router.replace({ pathname: '/dashboard' } as never);
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
