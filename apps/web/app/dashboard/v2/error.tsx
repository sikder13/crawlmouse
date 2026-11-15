'use client';

import '@/styles/v2/tokens.css';
import { SegmentError, type SegmentErrorProps } from '@/components/v2/screens/support/SegmentError';

/** The error boundary of the dashboard (CC-33 D5). */
export default function DashboardError(props: SegmentErrorProps) {
  return <SegmentError {...props} />;
}
