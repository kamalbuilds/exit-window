import { NextResponse } from "next/server";
import { readCallLog } from "@/lib/nansen";

const MAX_RECENT = 200;

export async function GET() {
  const entries = await readCallLog();

  const byEndpoint = new Map<string, { network: number; hits: number }>();
  let network = 0;
  let hits = 0;
  let successCount = 0;
  for (const e of entries) {
    const row = byEndpoint.get(e.endpoint) ?? { network: 0, hits: 0 };
    if (e.cache === "hit") {
      row.hits++;
      hits++;
    } else {
      row.network++;
      network++;
      if (e.status !== undefined && e.status >= 200 && e.status < 300) successCount++;
    }
    byEndpoint.set(e.endpoint, row);
  }

  const timestamps = entries.map((e) => e.ts).sort();
  const first = timestamps[0] ?? null;
  const last = timestamps[timestamps.length - 1] ?? null;
  const successRate = network > 0 ? Number(((successCount / network) * 100).toFixed(1)) : 0;

  const summary = {
    network,
    hits,
    first,
    last,
    successRate,
    byEndpoint: [...byEndpoint.entries()]
      .sort((a, b) => b[1].network + b[1].hits - (a[1].network + a[1].hits))
      .map(([endpoint, r]) => ({ endpoint, network: r.network, hits: r.hits })),
  };

  const recent = [...entries]
    .reverse()
    .slice(0, MAX_RECENT)
    .map((e) => ({
      ts: e.ts,
      endpoint: e.endpoint,
      cache: e.cache,
      ...(e.source !== undefined ? { source: e.source } : {}),
      ...(e.status !== undefined ? { status: e.status } : {}),
      ...(e.latencyMs !== undefined ? { latencyMs: e.latencyMs } : {}),
      ...(e.rows !== undefined ? { rows: e.rows } : {}),
      requestSummary: e.requestSummary,
    }));

  return NextResponse.json({ summary, recent });
}
