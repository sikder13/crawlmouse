import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PricingCards } from '@/components/billing/PricingCards';

export default function PricingPage() {
  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 pt-20 pb-32">
        <section className="text-center mb-10 max-w-2xl mx-auto">
          <h1 className="font-display font-bold text-5xl tracking-tight">Pricing</h1>
          <p className="mt-4 text-lg text-ink/70">Free is genuinely free. Pay only when you need exports, more pages, or the badge gone.</p>
        </section>
        <PricingCards
          monthlyPriceId={process.env.STRIPE_PRICE_ID_PRO_MONTHLY!}
          yearlyPriceId={process.env.STRIPE_PRICE_ID_PRO_YEARLY!}
        />
      </main>
      <Footer />
    </>
  );
}
