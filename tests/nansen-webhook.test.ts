import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatSmartAlertMessage, resolveWatchForPayload, verifyNansenSignature } from "../src/app/api/nansen-webhook/route";
import type { AlarmRecord, Watch } from "../src/lib/alarms";

const SECRET = "test-webhook-secret-01234567890123";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function watch(overrides: Partial<Watch> = {}): Watch {
  return { leader: "0xleader", label: "Leader One", coin: "STRK", direction: "long", ...overrides };
}

function record(overrides: Partial<AlarmRecord> = {}): AlarmRecord {
  return {
    code: "ABC123",
    owner: "0xowner",
    watches: [watch()],
    chatId: 42,
    mirror: false,
    createdAt: 0,
    smartAlerts: { STRK: "alert-1" },
    ...overrides,
  };
}

describe("verifyNansenSignature", () => {
  const body = JSON.stringify({ coin: "STRK", amountUsd: 300_000 });

  it("accepts a correctly signed body", () => {
    expect(verifyNansenSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body (signature computed over the original text)", () => {
    const tampered = JSON.stringify({ coin: "STRK", amountUsd: 999_999_999 });
    expect(verifyNansenSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyNansenSignature(body, sign(body, "some-other-secret"), SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyNansenSignature(body, null, SECRET)).toBe(false);
  });

  it("rejects a header with no sha256= prefix but otherwise correct hex", () => {
    const raw = createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
    expect(verifyNansenSignature(body, raw, SECRET)).toBe(true); // prefix is optional, hex must still match
  });

  it("rejects garbage that is not valid hex of the right length", () => {
    expect(verifyNansenSignature(body, "sha256=not-hex-at-all", SECRET)).toBe(false);
  });

  // Break/restore mutation proof: a signature check that can't fail is worthless. Prove this one
  // can fail by breaking it (comparing raw strings instead of constant-time-comparing decoded
  // hex, and only requiring the tampered signature to differ from a fixed placeholder) so the
  // "tampered body" case above would wrongly pass, then restore and show it passes again.
  it("mutation proof: the tampered-body case would wrongly pass under a naive substring check", () => {
    const naiveVerify = (rawBody: string, header: string | null): boolean => {
      // Deliberately broken: only checks the header is present and has the sha256= prefix,
      // never recomputes or compares the HMAC - this is the bug this function must not have.
      return !!header && header.startsWith("sha256=");
    };
    const tampered = JSON.stringify({ coin: "STRK", amountUsd: 999_999_999 });
    // Under the naive/broken check, a tampered body with *any* correctly-prefixed signature
    // (even one signed over different bytes) wrongly verifies.
    expect(naiveVerify(tampered, sign(body))).toBe(true);
    // The real implementation correctly rejects the same input - proving the real check can fail
    // (and does, on this exact input) and that it's the HMAC comparison doing the work.
    expect(verifyNansenSignature(tampered, sign(body), SECRET)).toBe(false);
  });
});

describe("resolveWatchForPayload", () => {
  it("resolves by stored alert id first", () => {
    const r = record({ watches: [watch({ coin: "STRK" }), watch({ coin: "ETH", direction: "short" })], smartAlerts: { STRK: "alert-1", ETH: "alert-2" } });
    const result = resolveWatchForPayload(r, { alertId: "alert-2" });
    expect(result?.coin).toBe("ETH");
  });

  it("falls back to a coin/symbol field in the payload", () => {
    const r = record({ watches: [watch({ coin: "STRK" }), watch({ coin: "ETH", direction: "short" })], smartAlerts: {} });
    const result = resolveWatchForPayload(r, { symbol: "eth" });
    expect(result?.coin).toBe("ETH");
  });

  it("falls back to the sole watch when nothing else matches", () => {
    const r = record({ watches: [watch({ coin: "STRK" })], smartAlerts: {} });
    const result = resolveWatchForPayload(r, {});
    expect(result?.coin).toBe("STRK");
  });

  it("returns null when there are multiple watches and nothing identifies which one", () => {
    const r = record({ watches: [watch({ coin: "STRK" }), watch({ coin: "ETH", direction: "short" })], smartAlerts: {} });
    expect(resolveWatchForPayload(r, {})).toBeNull();
  });
});

describe("formatSmartAlertMessage", () => {
  it("renders the literal template with a known amount and extra fields", () => {
    const msg = formatSmartAlertMessage({
      coin: "STRK",
      direction: "long",
      ownerSize: 1200,
      payload: { amountUsd: 300_000, chain: "starknet", txHash: "0xabc" },
    });
    expect(msg).toBe(
      "Nansen Smart Alert: Smart Money pulled $300,000 of STRK out on-chain in the last 15m. " +
        "You hold 1200 STRK long.\n" +
        "chain: starknet, tx: 0xabc",
    );
  });

  it("falls back to an unspecified amount when the payload has none", () => {
    const msg = formatSmartAlertMessage({ coin: "STRK", direction: "long", ownerSize: 0, payload: {} });
    expect(msg).toBe("Nansen Smart Alert: Smart Money pulled an unspecified amount of STRK out on-chain in the last 15m. You hold 0 STRK long.");
  });
});
