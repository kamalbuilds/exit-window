import { NextResponse } from "next/server";
import { fetchLeaderboard, NansenAuthError } from "@/lib/nansen";

export async function GET() {
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 86_400_000);
    const { data } = await fetchLeaderboard(from.toISOString().slice(0, 10), now.toISOString().slice(0, 10), 50);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "leaderboard request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
