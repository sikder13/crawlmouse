import { notFound } from 'next/navigation';

/**
 * The v2 previews exist only outside production. The group layout calls this, and so does each
 * page: Next renders a layout and its page in parallel, so a 404 from the layout alone still ships
 * the page's payload inside the 404 response. Read at call time, not at module load.
 */
export function previewOnly(): void {
  if (process.env.NODE_ENV === 'production') notFound();
}
