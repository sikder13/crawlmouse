import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Crawlmouse — Grade your site's internal linking',
  description: 'Free, no-install, instantly-shareable internal-linking grader for any website.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
