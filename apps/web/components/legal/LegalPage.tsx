import type { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-32 prose prose-ink">
        <h1 className="font-display font-bold text-5xl tracking-tight mb-6">{title}</h1>
        <div className="space-y-4 text-ink/80 leading-relaxed">{children}</div>
      </main>
      <Footer />
    </>
  );
}
