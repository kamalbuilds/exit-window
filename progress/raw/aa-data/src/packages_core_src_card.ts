import { sha256 } from "./client.js";
import { canonicalize } from "./cache.js";
import type { NansenClient } from "./client.js";
import type { LabelClass } from "./classes.js";
import { fetchClues, type Clues, type ClueFailure } from "./clues.js";
import { tell } from "./tell.js";
import { read } from "./reader.js";

export type Source = { endpoint: string; labelType: string | null; token: string | null; tag: string };

/** One card: the wallet, what Nansen says it is, the clues the player sees, the tell shown on reveal. */
export type Card = {
  id: string;
  address: string;
  chain: "ethereum";
  class: LabelClass;
  /** the free-tier `address_label` Nansen returned on the sourcing row (a wealth/structural tag or ENS name, never an entity name) */
  nansenLabel: string;
  /** optional entity name from the 1-credit tx-lookup ("🏦 Binance") — decoration on the reveal, not the answer key */
  entity: string | null;
  source: Source;
  clues: Clues;
  tell: string;
  readerGuess: LabelClass;
  readerBecause: string;
  cardHash: string;
  recordedAt: string;
  now: number;
};

/**
 * Everything a replay must reproduce: what the player sees (clues), the answer (class, label, entity) and the tell.
 * Cost, timing, cache metadata and the house reader's guess are excluded by design — the reader is a rule that may be
 * tuned after the deck is recorded, and `npm run reader` always recomputes it from the clues.
 */
export function cardProjection(c: Pick<Card, "address" | "chain" | "class" | "nansenLabel" | "entity" | "clues" | "tell">) {
  return canonicalize({ address: c.address, chain: c.chain, class: c.class, nansenLabel: c.nansenLabel, entity: c.entity, clues: c.clues, tell: c.tell });
}
export function cardHash(c: Parameters<typeof cardProjection>[0]): string {
  return sha256(JSON.stringify(cardProjection(c)));
}
export function cardId(address: string): string {
  return sha256(`labelme:${address.toLowerCase()}`).slice(0, 10);
}

export type BuildInput = { address: string; class: LabelClass; nansenLabel: string; entity?: string | null; source: Source };

/** The 4 clue calls → a finished card. `failures` lists degraded sections; the card is still dealt (the failure shows in provenance). */
export async function buildCard(c: NansenClient, input: BuildInput, now: number): Promise<{ card: Card; failures: ClueFailure[] }> {
  const address = input.address.toLowerCase();
  const { clues, failures } = await fetchClues(c, address, now);
  return { card: finishCard({ ...input, address }, clues, now), failures };
}

/** Nansen entity labels sometimes carry zero-width characters ("\u200b\u200b🏦 Robinhood") — strip them, keep the emoji. */
export function cleanEntity(entity: string | null | undefined): string | null {
  const e = (entity ?? "").replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  return e || null;
}

export function finishCard(input: BuildInput, clues: Clues, now: number): Card {
  input = { ...input, entity: cleanEntity(input.entity) };
  const address = input.address.toLowerCase();
  const t = tell(input.class, clues, input.nansenLabel, input.entity);
  const r = read(clues);
  const base = { address, chain: "ethereum" as const, class: input.class, nansenLabel: input.nansenLabel, entity: input.entity ?? null, clues, tell: t };
  return {
    id: cardId(address),
    ...base,
    source: input.source,
    readerGuess: r.guess,
    readerBecause: r.because,
    cardHash: cardHash(base),
    recordedAt: new Date(now).toISOString(),
    now,
  };
}

/** What the player sees before guessing: the card without its answer. */
export type CardFace = Pick<Card, "id" | "chain" | "clues" | "cardHash">;
export function face(card: Card): CardFace {
  return { id: card.id, chain: card.chain, clues: card.clues, cardHash: card.cardHash };
}
