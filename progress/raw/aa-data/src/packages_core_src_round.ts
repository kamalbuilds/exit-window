import { sha256 } from "./client.js";
import type { LabelClass } from "./classes.js";
import type { Card } from "./card.js";

import { normalizeSeed } from "./seed.js";
import { DECK_CLASSES, ROUND_SIZE } from "./constants.js";
export { normalizeSeed, DECK_CLASSES, ROUND_SIZE };

export type Round = { seed: string; deckHash: string; cardIds: string[] };

/** xorshift-free determinism: a sha256 stream keyed by the seed, consumed 4 bytes at a time */
export function rng(seed: string): () => number {
  let counter = 0;
  let buf = Buffer.alloc(0);
  let pos = 0;
  return () => {
    if (pos + 4 > buf.length) {
      buf = Buffer.from(sha256(`${seed}:${counter++}`), "hex");
      pos = 0;
    }
    const v = buf.readUInt32BE(pos);
    pos += 4;
    return v / 0x1_0000_0000;
  };
}

export function shuffle<T>(items: T[], next: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function deckHash(cards: Card[]): string {
  return sha256(cards.map((c) => c.cardHash).join("\n"));
}

export function randomSeed(): string {
  return sha256(`${Date.now()}:${Math.random()}`).slice(0, 8);
}

/**
 * Ten cards for a seed: round-robin over the classes present so every class appears (2 each with 5 classes),
 * deterministic given the seed and the deck. Cards are sorted by id first so file order never matters.
 */
export function makeRound(cards: Card[], seed: string, size = ROUND_SIZE): Round {
  const s = normalizeSeed(seed) || "meridian";
  const next = rng(s);
  const byClass = new Map<LabelClass, Card[]>();
  for (const c of [...cards].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!byClass.has(c.class)) byClass.set(c.class, []);
    byClass.get(c.class)!.push(c);
  }
  const order = shuffle(
    DECK_CLASSES.filter((k) => byClass.has(k)),
    next,
  );
  const queues = new Map(order.map((k) => [k, shuffle(byClass.get(k)!, next)]));
  const picked: Card[] = [];
  let guard = 0;
  while (picked.length < size && guard++ < size * 4) {
    for (const k of order) {
      const q = queues.get(k)!;
      if (q.length && picked.length < size) picked.push(q.shift()!);
    }
    if (order.every((k) => queues.get(k)!.length === 0)) break;
  }
  return { seed: s, deckHash: deckHash(cards), cardIds: shuffle(picked, next).map((c) => c.id) };
}

export type Guess = { cardId: string; guess: LabelClass; correct: boolean };
export function score(
  round: Round,
  cards: Map<string, Card>,
  guesses: Record<string, LabelClass>,
): { correct: number; total: number; streakBest: number; perClass: Record<LabelClass, { right: number; seen: number }>; house: number } {
  const perClass = Object.fromEntries(DECK_CLASSES.map((k) => [k, { right: 0, seen: 0 }])) as Record<LabelClass, { right: number; seen: number }>;
  let correct = 0,
    streak = 0,
    streakBest = 0,
    house = 0;
  for (const id of round.cardIds) {
    const c = cards.get(id);
    if (!c) continue;
    perClass[c.class] ??= { right: 0, seen: 0 };
    perClass[c.class].seen++;
    if (c.readerGuess === c.class) house++;
    if (guesses[id] === c.class) {
      correct++;
      perClass[c.class].right++;
      streak++;
      streakBest = Math.max(streakBest, streak);
    } else streak = 0;
  }
  return { correct, total: round.cardIds.length, streakBest, perClass, house };
}
