import { NextResponse } from "next/server";
import { fetchPerpPositions, NansenAuthError } from "@/lib/nansen";

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  try {
    const { data } = await fetchPerpPositions(address);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "positions request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
