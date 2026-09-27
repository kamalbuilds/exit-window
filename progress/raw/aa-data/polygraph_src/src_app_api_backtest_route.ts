import { NextResponse } from 'next/server';
import { backtestAsset } from '@/lib/backtest';
import { loadCorpus, scoreCorpus } from '@/lib/corpus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') ?? 'BTC').toUpperCase();
  const live = searchParams.get('live') === '1';
  const max = Number(searchParams.get('max') ?? 60);

  try {
    // Prefer the committed corpus: ~900 resolved markets already scored by the
    // backfill. Recomputing that on every page load would be slow and would
    // spend credits to reproduce an answer that cannot change.
    if (!live) {
      const corpus = await loadCorpus();
      if (corpus) {
        const scored = scoreCorpus(symbol, corpus.observations, corpus.generatedAt);
        if (scored) {
          return NextResponse.json(scored, {
            headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=172800' },
          });
        }
      }
    }

    const result = await backtestAsset(symbol, {
      maxMarkets: Math.min(Math.max(max, 5), 120),
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
