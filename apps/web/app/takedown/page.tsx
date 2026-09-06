import { TakedownForm } from './TakedownForm';

// The form itself is a client component, and Next refuses a `metadata` export from a module marked
// 'use client' — so this server shell carries the metadata and renders the form unchanged.
export const metadata = {
  title: 'Takedown request',
  alternates: { canonical: '/takedown' },
};

export default function TakedownPage() {
  return <TakedownForm />;
}
