import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { CompareForm } from '@/components/share/CompareForm';

export default function ComparePage() {
  return (
    <>
      <Header />
      <main className="max-w-md mx-auto px-6 pt-20 pb-32">
        <h1 className="font-display font-bold text-4xl tracking-tight">Compare two sites</h1>
        <p className="text-ink/70 mt-3 mb-8">Run both audits side-by-side. Both are subject to the standard free-tier limits.</p>
        <CompareForm />
      </main>
      <Footer />
    </>
  );
}
