import { NextResponse } from "next/server";
import { buildReport } from "@/lib/report";
import { NansenAuthError } from "@/lib/nansen";

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const url = new URL(req.url);
  const lookbackDays = Number(url.searchParams.get("lookbackDays")) || undefined;
  const maxEpisodes = Number(url.searchParams.get("maxEpisodes")) || undefined;
  try {
    const report = await buildReport(address, { lookbackDays, maxEpisodes });
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "wallet report failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
