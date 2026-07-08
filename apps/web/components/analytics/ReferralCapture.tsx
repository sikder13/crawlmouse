'use client';
import { useEffect } from 'react';
import { track } from '@/lib/analytics';
import { captureReferral } from '@/lib/share-url';

// SPEC 04 §13 — the K measurement: when a visitor lands from a shared/badge/report link carrying `?ref=`,
// fire `referral_landing{source}` exactly once. Renders nothing. The read + sanitize + fire logic lives
// in captureReferral (unit-tested); this is the thin mount-once client wrapper (mirrors TrackView).
export function ReferralCapture() {
  useEffect(() => {
    captureReferral(typeof window !== 'undefined' ? window.location.search : null, track);
  }, []);
  return null;
}
