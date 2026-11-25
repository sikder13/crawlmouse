import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { LoginForm } from './LoginForm';

// The sign-in form is a client component, and Next refuses a `metadata` export from a module marked
// 'use client' — so this server shell carries the metadata. It also draws v1's header and footer
// around the form, so the kept page's v2 target (app/(v2-kept)) can draw v2's in their place.
// Sign-in is an application surface: it was being indexed, and it must never compete with the
// public report pages. `follow` so the links out of it still carry.
export const metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: '/login' },
};

export default function LoginPage() {
  return (
    <>
      <Header />
      <LoginForm />
      <Footer />
    </>
  );
}
