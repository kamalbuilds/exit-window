import { NextResponse } from "next/server";
import { buildReport, getCachedReport } from "@/lib/report";
import { NansenAuthError, NansenCreditsError, NansenTimeoutError } from "@/lib/nansen";

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const url = new URL(req.url);
  const lookbackDays = Number(url.searchParams.get("lookbackDays")) || undefined;
  const maxEpisodes = Number(url.searchParams.get("maxEpisodes")) || undefined;

  if (url.searchParams.get("cached") === "1") {
    const report = getCachedReport(address, { lookbackDays, maxEpisodes });
    if (!report) return NextResponse.json({ error: "not cached" }, { status: 404 });
    return NextResponse.json(report);
  }

  try {
    const report = await buildReport(address, { lookbackDays, maxEpisodes });
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof NansenTimeoutError) {
      return NextResponse.json({ error: "nansen_timeout", retryAfterSec: err.retryAfterSec }, { status: 503 });
    }
    if (err instanceof NansenCreditsError) {
      return NextResponse.json(
        { error: "nansen_credits", message: "Nansen API credits are exhausted; showing cached data where available" },
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : "wallet report failed";
    console.error(`wallet report ${address} failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
