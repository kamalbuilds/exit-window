// Prints the "Why is it exiting?" answer built from data, for one leader and coin, exactly as the
// alarm worker sends it when the Nansen Agent is unavailable. Keyless-safe: with no NANSEN_API_KEY
// every Nansen read is served from cache or seed, and fills come from Hyperliquid.
// Usage: npx tsx scripts/why-sample.ts [leader] [coin] [long|short]
import { whyFromData } from "@/lib/why";

const [leader = "0x7fdafde5cfb5465924316eced2d3715494c517d1", coin = "SOL", dir = "long"] = process.argv.slice(2);

whyFromData(leader, coin, dir === "short" ? "short" : "long").then((answer) => {
  console.log(answer ?? "No data to answer with for this wallet and coin.");
});
