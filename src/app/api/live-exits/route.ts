import { NextResponse } from "next/server";
import { readEvents } from "@/lib/sentinel";

/** Raw sentinel events (see scripts/sentinel.ts), newest first, within the last `hours`. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const hoursParam = Number(url.searchParams.get("hours"));
  const hours = Number.isFinite(hoursParam) && hoursParam > 0 ? hoursParam : 24;
  const cutoff = Date.now() - hours * 3_600_000;
  const events = (await readEvents()).filter((e) => e.ts >= cutoff).sort((a, b) => b.ts - a.ts);
  return NextResponse.json(events);
}
