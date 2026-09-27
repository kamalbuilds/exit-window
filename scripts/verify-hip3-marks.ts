// One-off proof that attachMarkPrices resolves real mark prices for builder-deployed HIP-3
// positions (xyz:*, io:* dex-prefixed coins), not just the main perp market. Reads the real
// wallet's live Hyperliquid clearinghouse state (free, public, no Nansen call involved) and
// asserts every HIP-3 position gets a non-null markPx.
// Run with: npx tsx scripts/verify-hip3-marks.ts
export {}; // no top-level import/export otherwise -> tsc would treat this as a global script,
// colliding with other scripts/*.ts files' own top-level `main`.

async function main(): Promise<void> {
  const { fetchClearinghouseState, attachMarkPrices } = await import("../src/lib/hyperliquid");
  const address = "0xea0027b6ea9b6d7d401b5266979cc3b3ca87a918";
  const positions = await fetchClearinghouseState(address);
  const withMarks = await attachMarkPrices(positions);
  const hip3 = withMarks.filter((p) => p.coin.includes(":"));
  console.log("total positions:", withMarks.length);
  console.log(
    "HIP-3 positions:",
    JSON.stringify(
      hip3.map((p) => ({ coin: p.coin, entryPx: p.entryPx, markPx: p.markPx })),
      null,
      2,
    ),
  );
  if (hip3.length === 0) {
    console.error("FAIL: expected to find HIP-3 coin positions for this address (position set may have changed)");
    process.exit(1);
  }
  const stillNull = hip3.filter((p) => p.markPx === null);
  if (stillNull.length > 0) {
    console.error(
      "FAIL: HIP-3 positions with null markPx:",
      stillNull.map((p) => p.coin),
    );
    process.exit(1);
  }
  console.log("PASS: all HIP-3 positions resolved a real markPx");
}
void main();
