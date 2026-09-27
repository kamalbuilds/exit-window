// One-off proof that HIP-3 (builder-deployed) coins get real exit-window measurements from
// buildReport(), i.e. candlesForEpisode's fetchCandles(ep.coin, ...) resolves real candles for
// dex-prefixed coins like "xyz:CL"/"io:NBIS", not just the main perp market. Nansen credits are
// exhausted (per the standing latch), so this monkey-patches fetch to give api.nansen.ai the
// exact 403 insufficient_credits body Nansen really returns - no live Nansen traffic, no
// credits spent, same technique as scripts/verify-degraded-report.ts. Hyperliquid calls pass
// through untouched: they're free, and are exactly what this script is checking.
// Run with: npx tsx scripts/verify-hip3-windows.ts
export {};
process.env.NANSEN_API_KEY = process.env.NANSEN_API_KEY ?? "fake-key-for-verification-script";

const realFetch = global.fetch;
global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("api.nansen.ai")) {
    return new Response(JSON.stringify({ code: "insufficient_credits" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main(): Promise<void> {
  const { buildReport } = await import("../src/lib/report");
  const address = "0xea0027b6ea9b6d7d401b5266979cc3b3ca87a918";
  const report = await buildReport(address, { lookbackDays: 30, maxEpisodes: 50 });

  const hip3Coins = ["xyz:BRENTOIL", "xyz:CL", "xyz:SNDK", "io:NBIS"];
  const hip3Episodes = report.episodes.filter((e) => hip3Coins.includes(e.coin));
  const hip3Windows = report.windows.filter((w) => hip3Coins.includes(w.coin));
  const hip3Positions = report.openPositions.filter((p) => hip3Coins.includes(p.coin));

  console.log("degraded:", report.degraded, "dataAsOf:", report.dataAsOf);
  console.log(
    "HIP-3 episodes:",
    hip3Episodes.map((e) => e.coin),
  );
  console.log(
    "HIP-3 windows:",
    hip3Windows.map((w) => ({ coin: w.coin, windowMin: w.windowMin, candleInterval: w.candleInterval, maxAdversePct: w.maxAdversePct })),
  );
  console.log(
    "HIP-3 open positions:",
    hip3Positions.map((p) => ({ coin: p.coin, markPx: p.markPx })),
  );

  let failed = false;
  if (hip3Episodes.length === 0) {
    console.error("FAIL: expected at least one HIP-3 episode from this wallet's stored fills");
    failed = true;
  }
  const unresolvedWindows = hip3Windows.filter((w) => w.candleInterval === "unavailable");
  if (hip3Windows.length > 0 && unresolvedWindows.length === hip3Windows.length) {
    console.error("FAIL: every HIP-3 window has candleInterval 'unavailable' - candles never resolved");
    failed = true;
  }
  if (hip3Positions.some((p) => p.markPx === null)) {
    console.error("FAIL: a HIP-3 open position still has null markPx inside buildReport's own pipeline");
    failed = true;
  }

  global.fetch = realFetch;
  console.log(failed ? "\nFAIL" : "\nPASS: HIP-3 coins get real candles/windows and real marks through buildReport.");
  process.exit(failed ? 1 : 0);
}
void main();
