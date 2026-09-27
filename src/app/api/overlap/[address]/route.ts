import { NextResponse } from "next/server";
import { buildOverlap } from "@/lib/overlap";
import { NansenAuthError, NansenCreditsError, NansenTimeoutError } from "@/lib/nansen";

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  try {
    const overlap = await buildOverlap(address);
    return NextResponse.json(overlap);
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
    const message = err instanceof Error ? err.message : "overlap request failed";
    console.error(`overlap ${address} failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
