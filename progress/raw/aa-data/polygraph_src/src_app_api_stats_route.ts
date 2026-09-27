import { NextResponse } from 'next/server';
import { callStats } from '@/lib/nansen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live proof-of-work for the buildathon's 1,000-call requirement.
 * Counts outbound Nansen calls only — cache hits are reported separately and
 * are deliberately excluded from the headline number.
 */
export async function GET() {
  const s = callStats();
  return NextResponse.json({
    apiCallsThisInstance: s.apiCalls,
    cacheHits: s.cacheHits,
    errors: s.errors,
    byEndpoint: s.byEndpoint,
    instanceStartedAt: s.startedAt,
    note: 'Serverless instances are ephemeral; the cumulative total across the backfill run is recorded in data/backfill-report.json in the repo.',
  });
}
