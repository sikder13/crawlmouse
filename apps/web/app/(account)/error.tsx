'use client';

import '@/styles/v2/tokens.css';
import { SegmentError, type SegmentErrorProps } from '@/components/v2/screens/support/SegmentError';

/** The error boundary of the account pages (Settings, the account door, the deletion and email links) (CC-33 D5). */
export default function AccountError(props: SegmentErrorProps) {
  return <SegmentError {...props} />;
}
