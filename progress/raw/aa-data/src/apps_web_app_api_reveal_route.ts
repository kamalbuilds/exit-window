import { NextRequest } from "next/server";
import { DECK_CLASSES, type LabelClass } from "@labelme/core";
import { answerFor } from "@/lib/deck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/reveal?id=<cardId>&guess=<class> → the Nansen answer for one deck card + its four recorded calls replayed. 0 credits. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const guess = req.nextUrl.searchParams.get("guess") ?? "";
  if (!/^[0-9a-f]{10}$/.test(id)) return Response.json({ error: "id must be a 10-hex card id" }, { status: 400 });
  if (guess && !(DECK_CLASSES as string[]).includes(guess)) return Response.json({ error: `guess must be one of ${DECK_CLASSES.join(", ")}` }, { status: 400 });
  const a = await answerFor(id);
  if (!a) return Response.json({ error: "no such card in the deck" }, { status: 404 });
  return Response.json({ ...a, correct: guess ? (guess as LabelClass) === a.class : null }, { headers: { "cache-control": "no-store" } });
}
