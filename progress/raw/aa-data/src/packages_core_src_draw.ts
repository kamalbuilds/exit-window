import type { NansenClient, Call, CallStart } from "./client.js";
import { nansen, type HolderLabelType } from "./nansen.js";
import { classFromTag, tagIsNeutral, isPoolTag, type LabelClass } from "./classes.js";
import { buildCard, type Card } from "./card.js";
import { TOKENS } from "./sources.js";
import { rng, shuffle } from "./round.js";
import { allFailed, type ClueFailure } from "./clues.js";

export type DrawEvent =
  | { type: "start"; start: CallStart }
  | { type: "call"; call: Call }
  | { type: "picked"; class: LabelClass; token: string; page: number; candidates: number }
  | { type: "card"; card: Card }
  | { type: "error"; message: string };

export type DrawOptions = {
  class?: LabelClass;
  seed?: string;
  exclude?: Set<string>;
  now?: number;
  onProgress?: (e: DrawEvent) => void;
  tokens?: Record<string, string>;
};

export const DRAW_CLASSES: LabelClass[] = ["smart-money", "exchange", "whale", "contract", "regular"];
/** pools are rare in the top-100 of a meme coin (≈1 per page) but WETH's top holders are ~10 % Uniswap pools — contract draws start there */
export const POOL_RICH_TOKENS: Record<string, string> = {
  WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  MOG: TOKENS.MOG,
  PEPE: TOKENS.PEPE,
  TURBO: TOKENS.TURBO,
};

/** the sourcing call for a class: holders with the class filter; whale/contract read tags off a plain page; regular = who-bought-sold(excluded) */
async function candidatesFor(
  c: NansenClient,
  cls: LabelClass,
  token: string,
  page: number,
  now: number,
): Promise<{ address: string; tag: string; labelType: string | null; endpoint: string }[]> {
  if (cls === "smart-money") {
    // the live Smart Money feed: traders who traded in the last hours — active by construction, never a dormant holder
    const r = await nansen.smartMoneyTrades(c);
    return [...new Map(r.data.map((t) => [t.trader_address.toLowerCase(), t])).values()]
      .filter((t) => classFromTag(t.trader_address_label) !== "contract")
      .map((t) => ({ address: t.trader_address.toLowerCase(), tag: t.trader_address_label ?? "", labelType: null, endpoint: "smart-money/dex-trades" }));
  }
  if (cls === "regular") {
    const r = await nansen.whoBought(c, token, now);
    return r.data
      .filter((x) => tagIsNeutral(x.address_label))
      .map((x) => ({ address: x.address, tag: x.address_label ?? "", labelType: "exclude all 17 label groups", endpoint: "tgm/who-bought-sold" }));
  }
  // whale: the page with every label group excluded server-side, so a Token Billionaire that is really an exchange never deals as a whale;
  // contract: the plain page (pools sit inside Nansen's Exchange group and would be excluded)
  const lt: HolderLabelType = cls === "exchange" ? "exchange" : cls === "whale" ? "all_holders" : "all_holders_plain";
  const r = await nansen.holders(c, token, lt, page, 100);
  return r.data
    .filter((x) => x.address)
    .filter((x) =>
      cls === "whale"
        ? classFromTag(x.address_label) === "whale"
        : cls === "contract"
          ? isPoolTag(x.address_label)
          : classFromTag(x.address_label) !== "contract",
    )
    .map((x) => ({ address: x.address!, tag: x.address_label ?? "", labelType: lt === "all_holders_plain" ? "all_holders" : lt, endpoint: "tgm/holders" }));
}

/**
 * Draw one fresh card live: pick a class (random unless given), one sourcing page, one address not in `exclude`
 * (the committed deck), then the four clue calls. 13 credits. Every Nansen call is emitted as a `call` event as it
 * lands, so the UI can stream provenance rows. Throws on a failed sourcing call; a failed clue call degrades a section.
 */
export async function drawCard(c: NansenClient, opts: DrawOptions = {}): Promise<{ card: Card; failures: ClueFailure[] }> {
  const now = opts.now ?? Date.now();
  const next = rng(opts.seed ?? `${now}:${Math.random()}`);
  const cls = opts.class ?? DRAW_CLASSES[Math.floor(next() * DRAW_CLASSES.length)];
  // class lists (smart_money / exchange / who-bought-sold) are short — page 1 only; plain holder pages run deep — pages 1–3
  const tokens = opts.tokens
    ? shuffle(Object.entries(opts.tokens), next)
    : cls === "contract"
      ? [Object.entries(POOL_RICH_TOKENS)[0], ...shuffle(Object.entries(POOL_RICH_TOKENS).slice(1), next)]
      : shuffle(Object.entries(TOKENS), next);
  const deepPage = cls === "whale" || cls === "contract";
  // REGRESSION (audit 2026-09-19): every call is emitted the moment the client records it — the four clue calls run in parallel and
  // used to be emitted as one batch after the slowest landed, so the page could not show rows "as they land"
  const prevOnCall = c.onCall;
  const prevOnStart = c.onStart;
  c.onCall = (call) => {
    prevOnCall?.(call);
    opts.onProgress?.({ type: "call", call });
  };
  // the start event lets a UI draw the pending row (pulsing dot) before any bytes move; the `call` with the same seq resolves it
  c.onStart = (start) => {
    prevOnStart?.(start);
    opts.onProgress?.({ type: "start", start });
  };
  try {
    return await drawInner(c, opts, cls, tokens, deepPage, now, next);
  } finally {
    c.onCall = prevOnCall;
    c.onStart = prevOnStart;
  }
}

async function drawInner(
  c: NansenClient,
  opts: DrawOptions,
  cls: LabelClass,
  tokens: [string, string][],
  deepPage: boolean,
  now: number,
  next: () => number,
): Promise<{ card: Card; failures: ClueFailure[] }> {
  let fresh: Awaited<ReturnType<typeof candidatesFor>> = [];
  let sym = "";
  let page: number | undefined;
  // up to three sourcing pages (5 credits each) before giving up — a page whose rows are all in the deck is not a failure of Nansen
  for (const [trySym, token] of tokens.slice(0, cls === "smart-money" ? 1 : 3)) {
    sym = trySym;
    page = deepPage ? 1 + Math.floor(next() * 3) : 1;
    const rows = await candidatesFor(c, cls, token, page, now);
    fresh = rows.filter((r) => !opts.exclude?.has(r.address.toLowerCase()));
    opts.onProgress?.({
      type: "picked",
      class: cls,
      token: cls === "smart-money" ? "the live Smart Money feed" : sym,
      // page is always assigned just above, in this same iteration, before it is ever read — never undefined here
      page: page!,
      candidates: fresh.length,
    });
    if (fresh.length) break;
  }
  if (fresh.length === 0) throw new Error(`no unseen ${cls} wallet on the sourcing pages tried — try again`);
  // smart-money: prefer a row that will have trades; we cannot know before the clues, so pick at random and accept the card as dealt
  const pick = fresh[Math.floor(next() * fresh.length)];
  const result = await buildCard(
    c,
    {
      address: pick.address,
      class: cls,
      nansenLabel: pick.tag,
      source: { endpoint: pick.endpoint, labelType: pick.labelType, token: cls === "smart-money" ? null : sym, tag: pick.tag },
    },
    now,
  );
  // REGRESSION (review pass 1): four failed clue calls are not a card — the page must show an error, not four "unavailable" panels
  if (allFailed(result.card.clues))
    throw new Error(`Nansen returned no clues for ${pick.address.slice(0, 10)}… (${result.failures.map((f) => f.error.slice(0, 60)).join("; ")}) — try again`);
  opts.onProgress?.({ type: "card", card: result.card });
  return result;
}
