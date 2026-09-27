import { describe, expect, it } from "vitest";
import { diffPositions } from "../src/lib/follow";
import type { OpenPosition } from "../src/lib/types";

const AT = 1_700_000_000_000;

function pos(coin: string, direction: "long" | "short", size: number): OpenPosition {
  return { coin, direction, size, entryPx: 100, markPx: null, unrealizedPnlUsd: null, leverage: null, liquidationPx: null };
}

describe("diffPositions", () => {
  it("detects open, add, reduce, close and flip", () => {
    const prev: OpenPosition[] = [pos("BTC", "long", 1), pos("ETH", "long", 2), pos("SOL", "short", 5)];
    const next: OpenPosition[] = [
      pos("BTC", "long", 1.5), // add
      pos("ETH", "long", 1), // reduce
      pos("SOL", "long", 5), // flip
      pos("ARB", "long", 3), // open
    ];
    const changes = diffPositions(prev, next, AT);
    const byCoin = new Map(changes.map((c) => [c.coin, c]));

    expect(byCoin.get("BTC")?.kind).toBe("add");
    expect(byCoin.get("ETH")?.kind).toBe("reduce");
    expect(byCoin.get("ETH")?.reducedFraction).toBeCloseTo(0.5, 5);
    expect(byCoin.get("SOL")?.kind).toBe("flip");
    expect(byCoin.get("ARB")?.kind).toBe("open");
  });

  it("a reduce to zero is reported as close with reducedFraction 1", () => {
    const prev: OpenPosition[] = [pos("BTC", "long", 2)];
    const next: OpenPosition[] = [];
    const changes = diffPositions(prev, next, AT);
    expect(changes).toEqual([{ coin: "BTC", kind: "close", direction: "long", fromSize: 2, toSize: 0, reducedFraction: 1, at: AT }]);
  });
});
