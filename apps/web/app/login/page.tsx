import { LoginForm } from './LoginForm';

// The sign-in form is a client component, and Next refuses a `metadata` export from a module marked
// 'use client' — so this server shell carries the metadata and renders the form unchanged.
// Sign-in is an application surface: it was being indexed, and it must never compete with the
// public report pages. `follow` so the links out of it still carry.
export const metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: '/login' },
};

export default function LoginPage() {
  return <LoginForm />;
}
