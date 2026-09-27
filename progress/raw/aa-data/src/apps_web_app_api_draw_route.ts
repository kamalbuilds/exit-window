import { NextRequest } from "next/server";
import { CachedNansenClient, MemoryCache, drawCard, DECK_CLASSES, read, makeRound, type DrawEvent, type LabelClass } from "@labelme/core";
import { deck, replayCalls } from "@/lib/deck";
import { clientIp, ipAllowed, budgetExhausted, recordSpend, BUDGET_MESSAGE } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Out = DrawEvent | { type: "replay"; message: string } | { type: "house"; guess: LabelClass; because: string; credits: number; calls: number; ms: number };

/**
 * POST /api/draw?class=whale → NDJSON: {type:"call"} per Nansen call as it lands · {type:"picked"} · {type:"card"} · {type:"house"}
 * The only route that spends credits (13 per draw). Guard: 429 past the per-IP rate; past the daily ceiling the
 * stream deals a deck card instead, prefixed by {type:"replay"} so the page labels it.
 */
export async function POST(req: NextRequest) {
  const clsParam = req.nextUrl.searchParams.get("class") ?? "";
  const cls = (DECK_CLASSES as string[]).includes(clsParam) ? (clsParam as LabelClass) : undefined;
  if (clsParam && !cls) return Response.json({ error: `class must be one of ${DECK_CLASSES.join(", ")}` }, { status: 400 });
  const gate = ipAllowed(clientIp(req.headers));
  if (!gate.ok)
    return Response.json(
      { error: `Too many draws from this address — try again in ${gate.retryAfter} s` },
      { status: 429, headers: { "retry-after": String(gate.retryAfter), "cache-control": "no-store" } },
    );
  const key = process.env.NANSEN_API_KEY ?? "";
  const degraded = !key || budgetExhausted();

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: Out) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      const t0 = Date.now();
      try {
        if (degraded) {
          const d = deck();
          const r = makeRound(d.cards, `replay-${Date.now()}`, 1);
          const card = d.byId.get(r.cardIds[0])!;
          send({ type: "replay", message: key ? BUDGET_MESSAGE : "This deployment has no NANSEN_API_KEY — this card is a replay from the recorded deck." });
          // the rail still gets real rows: the card's four recorded calls, replayed through the engine (labelled replayed · 0 cr)
          for (const call of await replayCalls(card.address)) send({ type: "call", call });
          send({ type: "card", card });
          const h = read(card.clues);
          send({ type: "house", guess: h.guess, because: h.because, credits: 0, calls: 0, ms: Date.now() - t0 });
        } else {
          const client = new CachedNansenClient(key, { store: new MemoryCache() });
          try {
            const { card } = await drawCard(client, { class: cls, exclude: new Set(deck().cards.map((c) => c.address)), onProgress: send });
            const h = read(card.clues);
            send({ type: "house", guess: h.guess, because: h.because, credits: client.creditsSpent, calls: client.calls.length, ms: Date.now() - t0 });
          } finally {
            recordSpend(client.creditsSpent);
          }
        }
      } catch (e) {
        send({ type: "error", message: (e as Error).message.slice(0, 200) });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed by the client */
          }
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
