// Diffs two snapshots of a followed wallet's open positions to detect a reduce/close/flip to
// mirror. Pure function so the client can run the exact same logic while polling.
import type { OpenPosition, PositionChange } from "./types";

export function diffPositions(prev: OpenPosition[], next: OpenPosition[], at: number): PositionChange[] {
  const prevByCoin = new Map(prev.map((p) => [p.coin, p]));
  const nextByCoin = new Map(next.map((p) => [p.coin, p]));
  const coins = new Set([...prevByCoin.keys(), ...nextByCoin.keys()]);

  const changes: PositionChange[] = [];
  for (const coin of coins) {
    const p = prevByCoin.get(coin);
    const n = nextByCoin.get(coin);

    if (!p && n) {
      changes.push({ coin, kind: "open", direction: n.direction, fromSize: 0, toSize: n.size, reducedFraction: 0, at });
      continue;
    }
    if (p && !n) {
      changes.push({ coin, kind: "close", direction: p.direction, fromSize: p.size, toSize: 0, reducedFraction: 1, at });
      continue;
    }
    if (p && n) {
      if (p.direction !== n.direction) {
        changes.push({ coin, kind: "flip", direction: n.direction, fromSize: p.size, toSize: n.size, reducedFraction: 1, at });
      } else if (n.size > p.size) {
        changes.push({ coin, kind: "add", direction: n.direction, fromSize: p.size, toSize: n.size, reducedFraction: 0, at });
      } else if (n.size < p.size) {
        const reducedFraction = p.size > 0 ? (p.size - n.size) / p.size : 0;
        changes.push({ coin, kind: "reduce", direction: n.direction, fromSize: p.size, toSize: n.size, reducedFraction, at });
      }
    }
  }
  return changes;
}
