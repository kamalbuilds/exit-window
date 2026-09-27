// One-off proof that followLateSummary and exitRisk come out of buildReport() with real numbers
// for stored wallets, and that both survive a degraded (Nansen-credits-exhausted) report the same
// way windows/exitDna already do. Monkey-patches fetch so api.nansen.ai gets the real observed 403
// insufficient_credits body - no live Nansen traffic, no credits spent, same technique as
// scripts/verify-hip3-windows.ts. Hyperliquid candle calls pass through untouched (free, public).
// Run with: npx tsx scripts/verify-late-exit-risk.ts
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
  const { buildReport, getCachedReport } = await import("../src/lib/report");
  const addresses = ["0xea0027b6ea9b6d7d401b5266979cc3b3ca87a918", "0xb81219ef9f6d3fdc1ff893fa82d80840a651b5e0"];

  let failed = false;

  for (const address of addresses) {
    const report = await buildReport(address, { lookbackDays: 30, maxEpisodes: 50 });
    console.log(`\n=== ${address} (degraded: ${report.degraded}, dataAsOf: ${report.dataAsOf}) ===`);
    console.log("episodesAnalyzed:", report.episodesAnalyzed, "windows:", report.windows.length);
    console.log("exitRisk:", report.exitRisk);
    console.log("followLateSummary:", JSON.stringify(report.followLateSummary, null, 2));

    if (!report.exitRisk) {
      console.error("FAIL: exitRisk missing from buildReport() output");
      failed = true;
      continue;
    }
    if (report.exitRisk.level === "unknown" && report.exitDna !== null) {
      console.error("FAIL: exitRisk is unknown but exitDna has a sample - risk should have a real level");
      failed = true;
    }
    if (report.exitRisk.level !== "unknown" && report.exitRisk.sentence.length === 0) {
      console.error("FAIL: exitRisk has a real level but an empty sentence");
      failed = true;
    }

    const windowsWithLateCost = report.windows.filter((w) => w.lateCostPct.length > 0);
    console.log(`windows with at least one lateCostPct entry: ${windowsWithLateCost.length}/${report.windows.length}`);
    if (report.windows.length > 0 && windowsWithLateCost.length === 0) {
      console.error("FAIL: this wallet has windows but none produced any lateCostPct entry");
      failed = true;
    }
    if (windowsWithLateCost.length > 0 && report.followLateSummary === null) {
      console.error("FAIL: windows carry lateCostPct entries but followLateSummary is null");
      failed = true;
    }

    // Same cache the ?cached=1 route reads - must carry the same two fields untouched.
    const cached = getCachedReport(address, { lookbackDays: 30, maxEpisodes: 50 });
    if (!cached || cached.exitRisk?.level !== report.exitRisk.level || cached.followLateSummary?.worst?.pct !== report.followLateSummary?.worst?.pct) {
      console.error("FAIL: getCachedReport() (the ?cached=1 path) doesn't carry the same exitRisk/followLateSummary");
      failed = true;
    }
  }

  global.fetch = realFetch;
  console.log(failed ? "\nFAIL" : "\nPASS: followLateSummary and exitRisk are real, non-vacuous, and survive the cached-report path.");
  process.exit(failed ? 1 : 0);
}
void main();
