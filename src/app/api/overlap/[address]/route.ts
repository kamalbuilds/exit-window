import { NextResponse } from "next/server";
import { buildOverlap } from "@/lib/overlap";
import { NansenAuthError, NansenTimeoutError } from "@/lib/nansen";

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
    const message = err instanceof Error ? err.message : "overlap request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
