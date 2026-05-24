'use client';
import { useEffect } from 'react';
import { initAnalytics } from '@/lib/analytics';

export function AnalyticsBootstrap() {
  useEffect(() => { initAnalytics(); }, []);
  return null;
}
