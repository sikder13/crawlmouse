import { NextResponse } from 'next/server';
import pkg from '../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness probe. Deliberately touches no database or upstream service, so it answers "is this
// deployment serving?" and nothing else. `commit` is the Vercel git SHA when present, else null.
export function GET() {
  return NextResponse.json(
    { ok: true, version: pkg.version, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
