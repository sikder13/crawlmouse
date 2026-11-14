import { NextResponse } from 'next/server';
import { healthReport } from '../../../lib/v2/ops/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness probe. Deliberately touches no database or upstream service, so it answers "is this
// deployment serving?" and nothing else (lib/v2/ops/health.ts, which /status shows too).
export function GET() {
  return NextResponse.json(healthReport(), { headers: { 'Cache-Control': 'no-store' } });
}
