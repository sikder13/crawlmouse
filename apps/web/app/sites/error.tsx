'use client';

import '@/styles/v2/tokens.css';
import { SegmentError, type SegmentErrorProps } from '@/components/v2/screens/support/SegmentError';

/** The error boundary of a site's page (CC-33 D5). */
export default function SitesError(props: SegmentErrorProps) {
  return <SegmentError {...props} />;
}
