// Mirrors a followed leader's reduce/close into the follower's own Hyperliquid account.
// Per docs/BUILD-SPEC.md: "size the follower's close by the leader's reducedFraction of the
// follower's own open position on that coin", capped by MIRROR_MAX_USD (default 100).
//
// Live mode needs HL_API_WALLET_KEY (an Hyperliquid API/agent wallet's private key) and
// HL_ACCOUNT_ADDRESS (the main wallet it trades for). Both absent -> paper mode: record the
// would-be close at the live mid price, touch nothing. Both present -> live mode, but it still
// refuses unless the MAIN wallet has already approved Nansen's builder fee - a one-time step
// that can only be signed by the wallet's own key (never the API wallet), and happens outside
// this app. See progress/api-docs/trade_perp-trading.md#builder-fee.
import { hexToSignature } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { dexPrefix, fetchClearinghouseState, fetchMidsForDex } from "./hyperliquid";
import { executePerpAction, fetchBuilderFee, preparePerpClose, type Eip712Payload } from "./nansen";
import type { Direction, OpenPosition, PositionChange } from "./types";

const DEFAULT_MAX_USD = 100;

function maxUsd(): number {
  const n = Number(process.env.MIRROR_MAX_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_USD;
}

export interface MirrorResult {
  mode: "paper" | "live";
  coin: string;
  direction: Direction;
  followerSizeBefore: number;
  sizeToClose: number;
  price: number;
  usdValue: number;
  capped: boolean;
  executed: boolean;
  refusalReason?: string;
  nansenExecuteResponse?: unknown;
}

/** EIP-712 `signTypedData` wants only the message's own types, not the domain separator type
 * the server includes for completeness. */
function stripDomainType(types: Eip712Payload["types"]): Eip712Payload["types"] {
  const { EIP712Domain: _domain, ...rest } = types;
  return rest;
}

export async function mirrorChange(change: PositionChange, followerAddress: string | null): Promise<MirrorResult> {
  const cap = maxUsd();
  // A builder-deployed HIP-3 coin ("xyz:CL", "io:NBIS") only prices through its own dex's
  // allMids call - see hyperliquid.ts's attachMarkPrices for the same routing over a position
  // list; this is the single-coin equivalent for one leader change at a time.
  const mids = await fetchMidsForDex(dexPrefix(change.coin));
  const price = mids[change.coin] ?? 0;

  // Only reduce/close/flip changes have anything to mirror; open/add have reducedFraction 0.
  if (change.reducedFraction <= 0 || price <= 0) {
    return {
      mode: process.env.HL_API_WALLET_KEY && process.env.HL_ACCOUNT_ADDRESS ? "live" : "paper",
      coin: change.coin,
      direction: change.direction,
      followerSizeBefore: 0,
      sizeToClose: 0,
      price,
      usdValue: 0,
      capped: false,
      executed: false,
      refusalReason:
        price <= 0
          ? `No live mid price for ${change.coin} (HIP-3 or delisted coin - skipping)`
          : "Nothing to mirror: this change is an open or add, not a reduce",
    };
  }

  let followerSizeBefore: number;
  let followerPosition: OpenPosition | null = null;
  if (followerAddress) {
    // Hyperliquid's own clearinghouseState, not Nansen's perp/positions: free, live, no credits,
    // and (via hyperliquid.ts's dex fan-out) already sees a HIP-3 position that a main-dex-only
    // call would miss entirely.
    const positions = await fetchClearinghouseState(followerAddress);
    followerPosition = positions.find((p) => p.coin === change.coin) ?? null;
    followerSizeBefore = followerPosition?.size ?? 0;
  } else {
    // ponytail: no real follower account in paper mode, so there is no real position to scale
    // against. Mirror the leader's own displayed size 1:1 (still reducedFraction-scaled and
    // USD-capped below) so the paper ledger shows a plausible, deterministic close.
    followerSizeBefore = change.fromSize;
  }

  const rawSize = followerSizeBefore * change.reducedFraction;
  const rawUsd = rawSize * price;
  const capped = rawUsd > cap;
  const sizeToClose = capped ? cap / price : rawSize;
  const usdValue = sizeToClose * price;

  if (sizeToClose <= 0) {
    return {
      mode: followerAddress ? "live" : "paper",
      coin: change.coin,
      direction: change.direction,
      followerSizeBefore,
      sizeToClose: 0,
      price,
      usdValue: 0,
      capped: false,
      executed: false,
      refusalReason: "Follower has no open position on this coin to reduce",
    };
  }

  const hlKey = process.env.HL_API_WALLET_KEY;
  const hlAddress = process.env.HL_ACCOUNT_ADDRESS;
  if (!hlKey || !hlAddress) {
    return {
      mode: "paper",
      coin: change.coin,
      direction: change.direction,
      followerSizeBefore,
      sizeToClose,
      price,
      usdValue,
      capped,
      executed: false,
    };
  }

  const feeStatus = await fetchBuilderFee(hlAddress);
  if (!feeStatus.data.approved) {
    return {
      mode: "live",
      coin: change.coin,
      direction: change.direction,
      followerSizeBefore,
      sizeToClose,
      price,
      usdValue,
      capped,
      executed: false,
      refusalReason:
        "Live mirroring is blocked: the main wallet has not approved Nansen's builder fee yet. " +
        "This is a one-time step done outside Exit Window, signed by the main wallet's own key " +
        "(never the API/agent wallet) - see progress/api-docs/trade_perp-trading.md#builder-fee.",
    };
  }

  // Closing a long is a sell; closing a short is a buy. Reduce-only, so this can never flip.
  const isBuy = change.direction === "short";
  // change.coin is passed through as-is, e.g. "xyz:CL" for a HIP-3 coin: Nansen's perp/close
  // docs (progress/api-docs/trade_perp-trading.md, and docs.nansen.ai's own doc-query answer)
  // document `coin` only as "the perp asset/market symbol", with no separate HIP-3/builder-market
  // id scheme - so the same dex-prefixed identifier Hyperliquid's own clearinghouseState/allMids
  // use above is the only documented, consistent value to send. Unverified against a live
  // /perp/close call (Nansen credits are exhausted; this path only runs in live mode).
  const prepared = await preparePerpClose(hlAddress, change.coin, sizeToClose, price, isBuy);

  const account = privateKeyToAccount(hlKey as `0x${string}`);
  const { domain, types, primaryType, message } = prepared.data.eip712;
  const signatureHex = await account.signTypedData({
    domain,
    types: stripDomainType(types),
    primaryType,
    message,
  } as never);
  const parsed = hexToSignature(signatureHex);
  const signature = { r: parsed.r, s: parsed.s, v: Number(parsed.v) };

  const executed = await executePerpAction(
    prepared.data.action,
    prepared.data.nonce,
    signature,
    prepared.data.vaultAddress,
  );

  return {
    mode: "live",
    coin: change.coin,
    direction: change.direction,
    followerSizeBefore,
    sizeToClose,
    price,
    usdValue,
    capped,
    executed: true,
    nansenExecuteResponse: executed.data,
  };
}
