import { NextRequest } from "next/server";
import { normalizeSeed, randomSeed } from "@labelme/core";
import { roundFor } from "@/lib/deck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/round?seed=meridian1933 → ten card faces (clues only) for the seed; 0 Nansen calls, 0 credits. */
export function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("seed") ?? "";
  if (raw.length > 64) return Response.json({ error: "seed too long (max 64 characters)" }, { status: 400 });
  const seed = normalizeSeed(raw) || randomSeed();
  return Response.json(roundFor(seed), { headers: { "cache-control": "no-store" } });
}
