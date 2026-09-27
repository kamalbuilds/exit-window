import type { NansenClient } from "./client.js";
import { nansen, type HolderRow } from "./nansen.js";
import { classFromTag, tagIsNeutral, type LabelClass } from "./classes.js";
import type { Source } from "./card.js";

/** Deck sourcing tokens (ethereum). Large caps for exchanges/whales, mid caps for pools and regular buyers. */
export const TOKENS: Record<string, string> = {
  PEPE: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
  SHIB: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
  LINK: "0x514910771af9ca656af840dff83e8264ecf986ca",
  UNI: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
  MOG: "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a",
  TURBO: "0xa35923162c49cf95e6bf26623385eb431ad920d3",
};

export type Candidate = { address: string; class: LabelClass; nansenLabel: string; source: Source };
export type Dropped = { address: string; reason: string; lists: string[] };

type Seen = { lists: Map<LabelClass, { tag: string; source: Source }>; publicFigure: boolean; structural: string | null };

/**
 * Pull every sourcing list for the given tokens and resolve ONE class per address (spike.md precedence):
 * structural tag → contract; exchange list → exchange; smart-money list → smart-money; wealth tag → whale;
 * who-bought-sold(excluded) with a neutral tag → regular. Public-Figure-list members and exchange∩smart-money are dropped.
 * Cost: per token holders ×4 (20) + who-bought-sold (1); smart-money/dex-trades once (5).
 */
export async function gatherCandidates(
  c: NansenClient,
  now: number,
  tokens: Record<string, string> = TOKENS,
): Promise<{ candidates: Candidate[]; dropped: Dropped[] }> {
  const seen = new Map<string, Seen>();
  const at = (addr: string) => {
    const a = addr.toLowerCase();
    if (!seen.has(a)) seen.set(a, { lists: new Map(), publicFigure: false, structural: null });
    return seen.get(a)!;
  };
  const noteRows = (rows: HolderRow[], cls: LabelClass, source: Omit<Source, "tag">) => {
    for (const r of rows) {
      if (!r.address) continue;
      const s = at(r.address);
      const tag = r.address_label ?? "";
      if (!s.lists.has(cls)) s.lists.set(cls, { tag, source: { ...source, tag } });
      if (classFromTag(tag) === "contract") s.structural = tag;
    }
  };

  const sm = await nansen.smartMoneyTrades(c);
  noteRows(
    [...new Map(sm.data.map((t) => [t.trader_address.toLowerCase(), t])).values()].map((t) => ({
      address: t.trader_address,
      address_label: t.trader_address_label ?? "",
    })),
    "smart-money",
    { endpoint: "smart-money/dex-trades", labelType: null, token: null },
  );
  for (const [sym, token] of Object.entries(tokens)) {
    const [smh, ex, pf, plain, wb] = await Promise.all([
      nansen.holders(c, token, "smart_money"),
      nansen.holders(c, token, "exchange"),
      nansen.holders(c, token, "public_figure"),
      nansen.holders(c, token, "all_holders_plain"),
      nansen.whoBought(c, token, now),
    ]);
    noteRows(smh.data, "smart-money", { endpoint: "tgm/holders", labelType: "smart_money", token: sym });
    noteRows(ex.data, "exchange", { endpoint: "tgm/holders", labelType: "exchange", token: sym });
    for (const r of pf.data) if (r.address) at(r.address).publicFigure = true;
    // plain page: wealth tags → whale candidates, structural tags → contract candidates (recorded on the address)
    for (const r of plain.data) {
      if (!r.address) continue;
      const tag = r.address_label ?? "";
      const cls = classFromTag(tag);
      if (cls === "contract") at(r.address).structural = tag;
      if (cls === "whale" && !at(r.address).lists.has("whale"))
        at(r.address).lists.set("whale", { tag, source: { endpoint: "tgm/holders", labelType: "all_holders", token: sym, tag } });
    }
    for (const r of wb.data) {
      const tag = r.address_label ?? "";
      if (!tagIsNeutral(tag)) continue;
      const s = at(r.address);
      if (!s.lists.has("regular"))
        s.lists.set("regular", { tag, source: { endpoint: "tgm/who-bought-sold", labelType: "exclude all 17 label groups", token: sym, tag } });
    }
  }

  const candidates: Candidate[] = [];
  const dropped: Dropped[] = [];
  for (const [address, s] of seen) {
    const lists = [...s.lists.keys()];
    if (s.publicFigure) {
      dropped.push({ address, reason: "in Nansen's Public Figure group (class dropped after the spike)", lists: [...lists, "public-figure"] });
      continue;
    }
    if (s.structural) {
      const src = s.lists.get("exchange")?.source ??
        s.lists.get("whale")?.source ?? { endpoint: "tgm/holders", labelType: "all_holders", token: null, tag: s.structural };
      candidates.push({ address, class: "contract", nansenLabel: s.structural, source: { ...src, tag: s.structural } });
      continue;
    }
    if (s.lists.has("exchange") && s.lists.has("smart-money")) {
      dropped.push({ address, reason: "in both the Exchange and the Smart Money groups", lists });
      continue;
    }
    // Every address in `seen` that reaches this point was added by exactly one of: noteRows (sets "exchange" or
    // "smart-money"), the plain-page whale check (sets "whale"), or the who-bought-sold loop (always sets "regular"
    // when it touches an address) — publicFigure/structural addresses already `continue`d above. So `lists` always
    // has at least one of these four keys; "regular" is only ever the sole key (the other three routes never also
    // register "regular"), so there is no "regular, but also something else" case to drop.
    const cls: LabelClass = s.lists.has("exchange") ? "exchange" : s.lists.has("smart-money") ? "smart-money" : s.lists.has("whale") ? "whale" : "regular";
    const e = s.lists.get(cls)!;
    candidates.push({ address, class: cls, nansenLabel: e.tag, source: e.source });
  }
  return { candidates, dropped };
}
