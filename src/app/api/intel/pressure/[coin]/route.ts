import { NextResponse } from "next/server";
import { fetchPressureIntel } from "@/lib/intel";
import { NansenAuthError } from "@/lib/nansen";

export async function GET(req: Request, { params }: { params: Promise<{ coin: string }> }) {
  const { coin } = await params;
  const url = new URL(req.url);
  const side = url.searchParams.get("side");
  if (side !== "long" && side !== "short") {
    return NextResponse.json({ error: "query param side must be 'long' or 'short'" }, { status: 400 });
  }
  try {
    const pressure = await fetchPressureIntel(decodeURIComponent(coin), side);
    return NextResponse.json(pressure);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "pressure lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
