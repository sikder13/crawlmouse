import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { TakedownForm } from './TakedownForm';

// The form itself is a client component, and Next refuses a `metadata` export from a module marked
// 'use client' — so this server shell carries the metadata. It also draws v1's header and footer
// around the form, so the kept page's v2 target (app/(v2-kept)) can draw v2's in their place.
export const metadata = {
  title: 'Takedown request',
  alternates: { canonical: '/takedown' },
};

export default function TakedownPage() {
  return (
    <>
      <Header />
      <TakedownForm />
      <Footer />
    </>
  );
}
