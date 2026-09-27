// Gathers what buildWhyFromData needs for one leader and coin, from data the product already has:
// the wallet report (cached, else built on the keyless path), the cohort balance if Nansen's
// response is cached, and the sentinel's live-exits log. Shared by the alarm worker and
// scripts/why-sample.ts so the filmed answer is the one users get.
import { buildWhyFromData } from "./alarms";
import { fetchCohortIntel } from "./intel";
import { buildReport } from "./report";
import { readEvents, readSnapshot } from "./sentinel";
import type { Direction } from "./types";

const HOUR_MS = 3_600_000;
// The sentinel sweeps every 60 s. An older snapshot means it isn't running, and a quiet log from
// a stopped sentinel must never read as "nobody else sold".
const SENTINEL_FRESH_MS = 5 * 60_000;

export async function whyFromData(leader: string, coin: string, direction: Direction, nowMs = Date.now()): Promise<string | null> {
  const side = direction === "long" ? "Long" : "Short";
  const [report, cohort, events, snapshot] = await Promise.all([
    buildReport(leader).catch(() => null),
    fetchCohortIntel(coin).catch(() => null),
    readEvents().catch(() => []),
    readSnapshot().catch(() => null),
  ]);
  const sentinelLive = snapshot !== null && nowMs - snapshot.at < SENTINEL_FRESH_MS;
  const others = events.filter(
    (e) => e.coin === coin && e.side === side && e.ts >= nowMs - HOUR_MS && e.address.toLowerCase() !== leader.toLowerCase(),
  );
  return buildWhyFromData({
    coin,
    direction,
    report,
    cohort: cohort?.available ? cohort : null,
    othersLastHour: sentinelLive
      ? { wallets: new Set(others.map((e) => e.address.toLowerCase())).size, valueUsd: others.reduce((a, e) => a + e.valueUsd, 0) }
      : null,
  });
}
