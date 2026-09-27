import { describe, expect, it } from "vitest";
import {
  buildRulePreviewSentence,
  formatNearLiquidationMessage,
  formatNearLiquidationStoppedMessage,
  nearLiquidationDecision,
  parseAlarmRule,
  type AlarmRule,
} from "../src/lib/alarms";

describe("nearLiquidationDecision", () => {
  it("stays idle and does not fire while distance is above the threshold", () => {
    expect(nearLiquidationDecision(undefined, 10, 5)).toEqual({ fire: false, state: "idle" });
    expect(nearLiquidationDecision("idle", 5.1, 5)).toEqual({ fire: false, state: "idle" });
  });

  it("fires once when distance closes to at or under the threshold, arming", () => {
    expect(nearLiquidationDecision(undefined, 5, 5)).toEqual({ fire: true, state: "armed" });
    expect(nearLiquidationDecision("idle", 2, 5)).toEqual({ fire: true, state: "armed" });
  });

  it("does not re-fire while armed, even if distance keeps closing", () => {
    expect(nearLiquidationDecision("armed", 3, 5)).toEqual({ fire: false, state: "armed" });
    expect(nearLiquidationDecision("armed", 0.5, 5)).toEqual({ fire: false, state: "armed" });
  });

  it("does not recover (or fire) until distance passes withinPct * 1.5", () => {
    expect(nearLiquidationDecision("armed", 7, 5)).toEqual({ fire: false, state: "armed" }); // 7 <= 7.5
    expect(nearLiquidationDecision("armed", 7.5, 5)).toEqual({ fire: false, state: "armed" }); // boundary: not yet past
  });

  it("recovers to idle once distance passes withinPct * 1.5, with no fire on the recovery tick", () => {
    expect(nearLiquidationDecision("armed", 7.6, 5)).toEqual({ fire: false, state: "idle" });
  });

  it("can fire again after a recover-then-reapproach cycle", () => {
    const recovered = nearLiquidationDecision("armed", 10, 5);
    expect(recovered.state).toBe("idle");
    expect(nearLiquidationDecision(recovered.state, 4, 5)).toEqual({ fire: true, state: "armed" });
  });
});

describe("parseAlarmRule with near_liquidation", () => {
  function valid(overrides: Partial<AlarmRule> = {}): unknown {
    return { trigger: "near_liquidation", minReducePct: 0, action: "alert", askAgent: true, ...overrides };
  }

  it("accepts a well-formed near_liquidation rule with a custom liqWithinPct", () => {
    expect(parseAlarmRule(valid({ liqWithinPct: 8 }))).toEqual({
      trigger: "near_liquidation",
      minReducePct: 0,
      action: "alert",
      askAgent: true,
      liqWithinPct: 8,
    });
  });

  it("accepts near_liquidation with no liqWithinPct (worker defaults it to 5)", () => {
    expect(parseAlarmRule(valid())).toEqual({
      trigger: "near_liquidation",
      minReducePct: 0,
      action: "alert",
      askAgent: true,
    });
  });

  it("rejects a liqWithinPct that is zero, negative, over 100, or the wrong type", () => {
    expect(parseAlarmRule(valid({ liqWithinPct: 0 }))).toBeNull();
    expect(parseAlarmRule(valid({ liqWithinPct: -1 }))).toBeNull();
    expect(parseAlarmRule(valid({ liqWithinPct: 101 }))).toBeNull();
    expect(parseAlarmRule(valid({ liqWithinPct: "5" as never }))).toBeNull();
  });
});

describe("buildRulePreviewSentence with near_liquidation", () => {
  it("renders the plain sentence with the default 5%", () => {
    const rule: AlarmRule = { trigger: "near_liquidation", minReducePct: 0, action: "alert", askAgent: true };
    expect(buildRulePreviewSentence(rule, 4, "ETH")).toBe(
      "When price comes within 5% of the largest watched holder's liquidation, message me on Telegram.",
    );
  });

  it("renders a custom liqWithinPct and a cut action, with no reduce-percent qualifier", () => {
    const rule: AlarmRule = { trigger: "near_liquidation", minReducePct: 25, liqWithinPct: 8, action: "cut50", askAgent: true };
    expect(buildRulePreviewSentence(rule, 4, "ETH")).toBe(
      "When price comes within 8% of the largest watched holder's liquidation, message me on Telegram and cut my ETH position 50%.",
    );
  });
});

describe("formatNearLiquidationMessage", () => {
  it("names the holder, coin, side, distance and liquidation price, then the force-sold line and report link", () => {
    const msg = formatNearLiquidationMessage({
      leaderLabel: "Whale One",
      leaderAddress: "0xleaderaddress000000000000000000000000",
      coin: "ETH",
      direction: "long",
      markPx: 2400,
      distancePct: 4.2,
      liquidationPx: 2300,
      positionValueUsd: 512345,
      ownerSize: 3,
      appUrl: "https://exit-window.example",
    });
    expect(msg).toContain("Whale One (0xlead…0000) on ETH long");
    expect(msg).toContain("price 2,400 is 4.2% from its liquidation at 2,300");
    expect(msg).toContain("$512,345 is force-sold into your exit");
    expect(msg).toContain("You hold 3 ETH.");
    expect(msg).toContain("Report: https://exit-window.example/w/0xleaderaddress000000000000000000000000");
  });

  it("says the owner does not hold the coin when ownerSize is 0", () => {
    const msg = formatNearLiquidationMessage({
      leaderLabel: "Whale One",
      leaderAddress: "0xleaderaddress000000000000000000000000",
      coin: "ETH",
      direction: "long",
      markPx: 2400,
      distancePct: 4.2,
      liquidationPx: 2300,
      positionValueUsd: 512345,
      ownerSize: 0,
      appUrl: "https://exit-window.example",
    });
    expect(msg).toContain("You don't hold ETH right now.");
  });

  it("falls back to the short address when there is no label", () => {
    const msg = formatNearLiquidationMessage({
      leaderLabel: null,
      leaderAddress: "0x1234567890abcdef",
      coin: "BTC",
      direction: "short",
      markPx: 60000,
      distancePct: 1,
      liquidationPx: 60600,
      positionValueUsd: 1000,
      ownerSize: 0,
      appUrl: "https://x.example",
    });
    expect(msg).toContain("0x1234…cdef on BTC short");
  });

  it("includes the protection line when given", () => {
    const msg = formatNearLiquidationMessage({
      leaderLabel: "Whale One",
      leaderAddress: "0xleaderaddress000000000000000000000000",
      coin: "ETH",
      direction: "long",
      markPx: 2400,
      distancePct: 4.2,
      liquidationPx: 2300,
      positionValueUsd: 512345,
      ownerSize: 0,
      appUrl: "https://exit-window.example",
      protectionLine: "Protection rule: Paper mode closed 1.0000 ETH (~$2,400).",
    });
    expect(msg).toContain("Protection rule: Paper mode closed");
  });
});

describe("formatNearLiquidationStoppedMessage", () => {
  it("says plainly that the leader no longer holds the coin and checking has stopped", () => {
    expect(formatNearLiquidationStoppedMessage("Whale One", "0xleaderaddress000000000000000000000000", "ETH")).toBe(
      "Whale One (0xlead…0000) no longer holds ETH. Stopped checking it for liquidation risk.",
    );
  });

  it("falls back to the short address when there is no label", () => {
    expect(formatNearLiquidationStoppedMessage(null, "0x1234567890abcdef", "BTC")).toBe(
      "0x1234…cdef no longer holds BTC. Stopped checking it for liquidation risk.",
    );
  });
});
