// One-off proof that buildReport() degrades instead of 503ing when Nansen credits are
// exhausted, for the two addresses this was reported broken against. Monkey-patches fetch so
// any call to api.nansen.ai gets the exact 403 insufficient_credits body Nansen really returns
// (no real Nansen traffic, no credits spent); Hyperliquid calls pass through untouched, since
// they're free and exactly what the degraded path is supposed to fall back on for real.
// Run with: npx tsx scripts/verify-degraded-report.ts
process.env.NANSEN_API_KEY = process.env.NANSEN_API_KEY ?? "fake-key-for-verification-script";

const realFetch = global.fetch;
let nansenAttempts = 0;
let hyperliquidCalls = 0;

global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("api.nansen.ai")) {
    nansenAttempts++;
    return new Response(JSON.stringify({ code: "insufficient_credits" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("hyperliquid.xyz")) {
    hyperliquidCalls++;
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main(): Promise<void> {
  const { buildReport } = await import("../src/lib/report");

  const ADDRESSES = ["0xea0027b6ea9b6d7d401b5266979cc3b3ca87a918", "0xb81219ef9f6d3fdc1ff893fa82d80840a651b5e0"];

  let failed = false;
  for (const address of ADDRESSES) {
    nansenAttempts = 0;
    hyperliquidCalls = 0;
    try {
      const report = await buildReport(address, { lookbackDays: 30, maxEpisodes: 25 });
      const ok =
        typeof report.address === "string" &&
        typeof report.degraded === "boolean" &&
        (report.dataAsOf === null || typeof report.dataAsOf === "number") &&
        Array.isArray(report.openPositions);
      console.log(
        `${address}: status=200 degraded=${report.degraded} dataAsOf=${report.dataAsOf ? new Date(report.dataAsOf).toISOString() : "null"} realizedPnlUsd=${report.realizedPnlUsd} openPositions=${report.openPositions.length} nansenAttempts=${nansenAttempts} hyperliquidCalls=${hyperliquidCalls} shapeOk=${ok}`,
      );
      if (!ok || !report.degraded) {
        console.error(`  FAIL: expected a 200 response with degraded=true and a valid shape for ${address}`);
        failed = true;
      }
    } catch (err) {
      console.error(`${address}: FAIL - buildReport threw instead of degrading: ${err instanceof Error ? err.message : err}`);
      failed = true;
    }
  }

  global.fetch = realFetch;
  console.log(
    failed
      ? "\nFAIL: at least one address did not degrade to a 200 response."
      : "\nPASS: both addresses returned 200 with degraded=true and zero real Nansen traffic.",
  );
  process.exit(failed ? 1 : 0);
}

void main();
