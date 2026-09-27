import { describe, expect, it } from "vitest";
import {
  alarmsForChat,
  bindCode,
  buildWhyQuestion,
  buildWhyTestQuestion,
  createAlarmRecord,
  distinctLeaderCount,
  dropWatch,
  formatAlarmMessage,
  formatConsensusMessage,
  formatDropMessage,
  formatOnboardingMessage,
  formatProtectionLine,
  formatTestMessage,
  formatWhyAnswer,
  markHeld,
  ownerStillHolds,
  pruneRecent,
  randomCode,
  readExitDna,
  setSmartAlertId,
  shouldDropForClose,
  shouldFire,
  smartAlertIdsForChat,
  unbindChat,
  whyCacheKey,
  type AlarmStore,
  type RecentReduce,
  type Watch,
} from "../src/lib/alarms";
import type { MirrorResult } from "../src/lib/mirror";
import type { ExitDna, OpenPosition, PositionChange, WalletReport } from "../src/lib/types";

const AT = 1_700_000_000_000;

function change(overrides: Partial<PositionChange> = {}): PositionChange {
  return { coin: "ETH", kind: "reduce", direction: "long", fromSize: 10, toSize: 5, reducedFraction: 0.5, at: AT, ...overrides };
}

function watch(overrides: Partial<Watch> = {}): Watch {
  return { leader: "0xleader", label: "Leader One", coin: "ETH", direction: "long", ...overrides };
}

describe("randomCode", () => {
  it("generates a 12-char code from the unambiguous alphabet", () => {
    const code = randomCode();
    expect(code).toHaveLength(12);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });

  it("generates a different code on each call", () => {
    expect(randomCode()).not.toBe(randomCode());
  });
});

describe("shouldFire", () => {
  it("fires on a reduce of the exact coin and direction being watched", () => {
    expect(shouldFire(change(), watch())).toBe(true);
  });

  it("fires on a close", () => {
    expect(shouldFire(change({ kind: "close", reducedFraction: 1 }), watch())).toBe(true);
  });

  it("does not fire on an open or add - the leader growing the position is not an exit", () => {
    expect(shouldFire(change({ kind: "open", reducedFraction: 0 }), watch())).toBe(false);
    expect(shouldFire(change({ kind: "add", reducedFraction: 0 }), watch())).toBe(false);
  });

  it("rejects open/add on the kind check alone, even with a nonzero fraction (defense in depth:\n   real diffs never pair 'add' with a fraction, but the guard must not rely on that)", () => {
    expect(shouldFire(change({ kind: "add", reducedFraction: 0.5 }), watch())).toBe(false);
  });

  it("does not fire on a different coin or direction", () => {
    expect(shouldFire(change({ coin: "BTC" }), watch())).toBe(false);
    expect(shouldFire(change({ direction: "short" }), watch())).toBe(false);
  });
});

describe("formatAlarmMessage", () => {
  it("names the leader, the percent closed, the window, and the owner's remaining size", () => {
    const msg = formatAlarmMessage({
      leaderLabel: "Leader One",
      leaderAddress: "0xleaderaddress000000000000000000000000",
      change: change(),
      medianWindowMin: 42,
      ownerSize: 3,
      appUrl: "https://exit-window.example",
    });
    expect(msg).toContain("Leader One started exiting your ETH long: -50%");
    expect(msg).toContain("median 42 min");
    expect(msg).toContain("You hold 3 ETH");
    expect(msg).toContain("https://exit-window.example/w/0xleaderaddress000000000000000000000000");
  });

  it("falls back to a short address when there is no label", () => {
    const msg = formatAlarmMessage({
      leaderLabel: null,
      leaderAddress: "0x1234567890abcdef",
      change: change(),
      medianWindowMin: null,
      ownerSize: 1,
      appUrl: "https://x.example",
    });
    expect(msg).toContain("0x1234…cdef");
    expect(msg).toContain("an unmeasured window");
  });
});

describe("formatDropMessage", () => {
  it("names the coin and the leader that is no longer watched, and says the coin was actually held", () => {
    const msg = formatDropMessage(watch({ leader: "0x1234567890abcdef" }));
    expect(msg).toBe("You held ETH and have now closed it fully. Stopped watching 0x1234…cdef on it.");
  });
});

describe("ownerStillHolds", () => {
  const positions: OpenPosition[] = [{ coin: "ETH", direction: "long", size: 3, entryPx: 100, markPx: null, unrealizedPnlUsd: null, leverage: null }];
  it("is true when the coin is in the position list", () => expect(ownerStillHolds(positions, "ETH")).toBe(true));
  it("is false once the coin is gone", () => expect(ownerStillHolds(positions, "BTC")).toBe(false));
});

describe("code binding", () => {
  function store(): AlarmStore {
    const record = createAlarmRecord("0xowner", [watch()]);
    return { [record.code]: record };
  }

  it("binds a chat to the alarm matching its code", () => {
    const s = store();
    const code = Object.keys(s)[0];
    const bound = bindCode(s, code, 555);
    expect(bound).not.toBeNull();
    expect(bound?.record.chatId).toBe(555);
    expect(bound?.store[code].chatId).toBe(555);
  });

  it("returns null for an unknown code, leaving the store untouched", () => {
    const s = store();
    expect(bindCode(s, "NOPE-CODE", 555)).toBeNull();
  });

  it("unbindChat removes every alarm bound to that chat, keeps the rest", () => {
    const s = store();
    const code = Object.keys(s)[0];
    const bound = bindCode(s, code, 555)!;
    const other: AlarmStore = { ...bound.store, OTHER: createAlarmRecord("0xowner2", [watch()]) };
    const cleared = unbindChat(other, 555);
    expect(cleared[code]).toBeUndefined();
    expect(cleared.OTHER).toBeDefined();
  });

  it("alarmsForChat lists only the alarms bound to that chat", () => {
    const s = store();
    const code = Object.keys(s)[0];
    const bound = bindCode(s, code, 555)!;
    expect(alarmsForChat(bound.store, 555)).toHaveLength(1);
    expect(alarmsForChat(bound.store, 999)).toHaveLength(0);
  });

  it("dropWatch removes only the named coin, leaving other watches on the alarm intact", () => {
    const record = createAlarmRecord("0xowner", [watch({ coin: "ETH" }), watch({ coin: "BTC" })]);
    const s: AlarmStore = { [record.code]: record };
    const updated = dropWatch(s, record.code, "ETH");
    expect(updated[record.code].watches.map((w) => w.coin)).toEqual(["BTC"]);
  });
});

describe("owner-close logic", () => {
  it("shouldDropForClose is false when the owner never held the coin (bind-time guard)", () => {
    expect(shouldDropForClose(watch({ everHeld: undefined }), false)).toBe(false);
  });

  it("shouldDropForClose is false while the owner still holds the coin, even if everHeld", () => {
    expect(shouldDropForClose(watch({ everHeld: true }), true)).toBe(false);
  });

  it("shouldDropForClose is true only once the owner held it and then fully closed it", () => {
    expect(shouldDropForClose(watch({ everHeld: true }), false)).toBe(true);
  });

  it("markHeld flips everHeld true for the matching coin and leaves other watches untouched", () => {
    const record = createAlarmRecord("0xowner", [watch({ coin: "ETH" }), watch({ coin: "BTC" })]);
    const s: AlarmStore = { [record.code]: record };
    const updated = markHeld(s, record.code, "ETH");
    expect(updated[record.code].watches.find((w) => w.coin === "ETH")?.everHeld).toBe(true);
    expect(updated[record.code].watches.find((w) => w.coin === "BTC")?.everHeld).toBeUndefined();
  });

  it("markHeld never flips an already-held watch back off, and is a no-op once already true", () => {
    const record = createAlarmRecord("0xowner", [watch({ coin: "ETH", everHeld: true })]);
    const s: AlarmStore = { [record.code]: record };
    const updated = markHeld(s, record.code, "ETH");
    expect(updated[record.code].watches[0].everHeld).toBe(true);
  });

  it("an owner==leader test alarm (everHeld unset, currently holding) never drops", () => {
    // Mirrors data/alarms.json's STRK test alarm: owner === leader, so as soon as the owner's
    // position shows up, holdsNow is true and the watch must never be dropped.
    expect(shouldDropForClose(watch({ leader: "0xsame", everHeld: undefined }), true)).toBe(false);
  });
});

describe("consensus grouping", () => {
  function reduce(overrides: Partial<RecentReduce> = {}): RecentReduce {
    return {
      leader: "0xleader1",
      label: "Leader One",
      pctClosed: 30,
      usdValue: 1000,
      medianWindowMin: 20,
      exitDna: null,
      at: AT,
      ...overrides,
    };
  }

  it("pruneRecent drops entries older than the window, keeps recent ones", () => {
    const entries = [reduce({ at: AT - 61 * 60_000 }), reduce({ at: AT - 10 * 60_000 })];
    const kept = pruneRecent(entries, AT, 60 * 60_000);
    expect(kept).toHaveLength(1);
    expect(kept[0].at).toBe(AT - 10 * 60_000);
  });

  it("pruneRecent keeps everything when nothing is older than the window - the check can fail", () => {
    const entries = [reduce({ at: AT - 1000 }), reduce({ at: AT - 2000 })];
    expect(pruneRecent(entries, AT, 60 * 60_000)).toHaveLength(2);
  });

  it("distinctLeaderCount counts unique leaders, not events", () => {
    const history = [reduce({ leader: "0xa" }), reduce({ leader: "0xa" }), reduce({ leader: "0xb" })];
    expect(distinctLeaderCount(history)).toBe(2);
  });

  it("formatConsensusMessage leads with 'N of M Smart Money wallets ... reduced in the last hour'", () => {
    const msg = formatConsensusMessage({
      coin: "STRK",
      direction: "long",
      totalWatched: 5,
      events: [
        reduce({ leader: "0xa", label: "A", pctClosed: 40, usdValue: 2000, medianWindowMin: 15 }),
        reduce({ leader: "0xb", label: "B", pctClosed: 20, usdValue: 500, medianWindowMin: 30, exitDna: "Scaler, nuclear last leg." }),
        reduce({ leader: "0xc", label: null, pctClosed: 100, usdValue: 900, medianWindowMin: null }),
      ],
      ownerSize: 12,
      appUrl: "https://exit-window.example",
    });
    expect(msg).toContain("3 of 5 Smart Money wallets in your STRK long reduced in the last hour.");
    expect(msg).toContain("A: reduced by 40% ($2,000), median 15 min window.");
    expect(msg).toContain("Scaler, nuclear last leg.");
    expect(msg).toContain("You hold 12 STRK");
  });

  it("formatConsensusMessage appends the protection line when given one", () => {
    const msg = formatConsensusMessage({
      coin: "STRK",
      direction: "long",
      totalWatched: 2,
      events: [reduce({ leader: "0xa" }), reduce({ leader: "0xb" })],
      ownerSize: 1,
      appUrl: "https://x.example",
      protectionLine: "Protection rule: Paper mode would close 1.0000 STRK (~$100).",
    });
    expect(msg).toContain("Protection rule: Paper mode would close 1.0000 STRK");
  });
});

describe("formatProtectionLine", () => {
  function mirrorResult(overrides: Partial<MirrorResult> = {}): MirrorResult {
    return {
      mode: "paper",
      coin: "STRK",
      direction: "long",
      followerSizeBefore: 10,
      sizeToClose: 2,
      price: 0.5,
      usdValue: 1,
      capped: false,
      executed: false,
      ...overrides,
    };
  }

  it("reports paper mode with the size and USD value it would close", () => {
    const line = formatProtectionLine(mirrorResult());
    expect(line).toBe("Protection rule: Paper mode would close 2.0000 STRK (~$1).");
  });

  it("reports live mode as closed once executed", () => {
    const line = formatProtectionLine(mirrorResult({ mode: "live", executed: true }));
    expect(line).toContain("Live mode closed 2.0000 STRK");
  });

  it("notes when the size was capped by MIRROR_MAX_USD", () => {
    expect(formatProtectionLine(mirrorResult({ capped: true }))).toContain("(capped by MIRROR_MAX_USD)");
  });

  it("reports a refusal reason verbatim instead of a size, when one exists", () => {
    const line = formatProtectionLine(mirrorResult({ refusalReason: "no live mid price for STRK" }));
    expect(line).toBe("Protection rule: not triggered - no live mid price for STRK");
  });
});

describe("readExitDna", () => {
  function baseReport(exitDna: ExitDna | null = null): WalletReport {
    return {
      address: "0xabc",
      label: null,
      generatedAt: AT,
      lookbackDays: 30,
      episodesAnalyzed: 1,
      exitStyle: "scaler",
      medianWindowMin: 12,
      windows: [],
      latency: [],
      maxSafeLatencySec: null,
      verdict: "tight",
      realizedPnlUsd: null,
      unrealizedPnlUsd: null,
      episodes: [],
      exitDna,
      alarmReplay: null,
      openPositions: [],
      nansenCalls: 0,
      backtestEligible: 0,
      backtestNote: null,
      degraded: false,
      dataAsOf: null,
    };
  }

  it("returns null when the report's exitDna is null", () => {
    expect(readExitDna(baseReport(null))).toBeNull();
  });

  it("formats a scaler ExitDna into a sentence with the median window", () => {
    const dna: ExitDna = {
      sample: 6,
      firstReduceToFlatMedianMin: 45,
      fullExitAfterFirstReducePct: 10,
      medianClips: 3,
      firstReduceAtPnlPct: 4.2,
      style: "scaler",
    };
    expect(readExitDna(baseReport(dna))).toBe(
      "Scaler: usually takes 3 clips to get flat. Median 45 min from first reduce to flat.",
    );
  });

  it("formats a nuclear ExitDna without a window sentence when the window is unmeasured", () => {
    const dna: ExitDna = {
      sample: 4,
      firstReduceToFlatMedianMin: null,
      fullExitAfterFirstReducePct: 90,
      medianClips: 1,
      firstReduceAtPnlPct: null,
      style: "nuclear",
    };
    expect(readExitDna(baseReport(dna))).toBe("Nuclear exiter: usually flat in one clip (90% of the time).");
  });

  it("formats trimmer and mixed styles", () => {
    const trimmer: ExitDna = {
      sample: 5,
      firstReduceToFlatMedianMin: 20,
      fullExitAfterFirstReducePct: 5,
      medianClips: 4,
      firstReduceAtPnlPct: 1.1,
      style: "trimmer",
    };
    expect(readExitDna(baseReport(trimmer))).toBe(
      "Trimmer: usually trims rather than closes on the first reduce. Median 20 min from first reduce to flat.",
    );

    const mixed: ExitDna = {
      sample: 5,
      firstReduceToFlatMedianMin: null,
      fullExitAfterFirstReducePct: 50,
      medianClips: 2,
      firstReduceAtPnlPct: null,
      style: "mixed",
    };
    expect(readExitDna(baseReport(mixed))).toBe("Mixed exit style: no strong single pattern.");
  });
});

describe("formatTestMessage", () => {
  it("is clearly labeled as a test and never claims a reduce happened", () => {
    const msg = formatTestMessage({
      watch: watch(),
      leaderPosition: { coin: "ETH", direction: "long", size: 4, entryPx: 2500, markPx: null, unrealizedPnlUsd: null, leverage: null },
      medianWindowMin: 18,
      appUrl: "https://exit-window.example",
    });
    expect(msg).toContain("Test alert");
    expect(msg).not.toMatch(/reduced your|started exiting your|closed your/);
    expect(msg).toContain("Leader One currently holds 4 ETH (long)");
    expect(msg).toContain("median 18 min");
  });

  it("still labels itself a test when the leader has no open position", () => {
    const msg = formatTestMessage({
      watch: watch(),
      leaderPosition: null,
      medianWindowMin: null,
      appUrl: "https://x.example",
    });
    expect(msg).toContain("Test alert");
    expect(msg).toContain("has no open ETH position right now");
  });
});

describe("formatOnboardingMessage", () => {
  it("returns a placeholder when there are no watches yet", () => {
    expect(formatOnboardingMessage([], "https://x.example")).toContain("No watches bound");
  });

  it("links the leader label to the wallet report, shows position, window, entry gap, protection and commands", () => {
    const msg = formatOnboardingMessage(
      [
        {
          watch: watch({ leader: "0xleaderaddress000000000000000000000000", protect: { reducePct: 25 } }),
          leaderPosition: { coin: "ETH", direction: "long", size: 4, entryPx: 2000, markPx: null, unrealizedPnlUsd: null, leverage: null },
          leaderMarkPx: 2100,
          medianWindowMin: 14,
          exitDna: "Scaler, usually 2-3 reduces before flat.",
          ownerPosition: { coin: "ETH", direction: "long", size: 1, entryPx: 2200, markPx: null, unrealizedPnlUsd: null, leverage: null },
        },
      ],
      "https://exit-window.example",
    );
    expect(msg).toContain('<a href="https://exit-window.example/w/0xleaderaddress000000000000000000000000">Leader One</a>');
    expect(msg).toContain("4 ETH (~$8,400), entry $2000");
    expect(msg).toContain("Median exit window: 14 min");
    expect(msg).toContain("Scaler, usually 2-3 reduces before flat.");
    expect(msg).toContain("You entered 10.0% above this wallet.");
    expect(msg).toContain("Protection: on a reduce, cut your position 25%.");
    expect(msg).toContain("/list");
    expect(msg).toContain("/stop");
    expect(msg).toContain("/test");
  });

  it("falls back to a short address when the watch has no label", () => {
    const msg = formatOnboardingMessage(
      [
        {
          watch: watch({ leader: "0x1234567890abcdef", label: null }),
          leaderPosition: null,
          leaderMarkPx: null,
          medianWindowMin: null,
          exitDna: null,
          ownerPosition: null,
        },
      ],
      "https://x.example",
    );
    expect(msg).toContain(">0x1234…cdef<");
    expect(msg).toContain("not currently open on ETH");
  });

  it("mentions armed Nansen alerts and leaves skipped coins out of the chat", () => {
    const msg = formatOnboardingMessage(
      [
        {
          watch: watch(),
          leaderPosition: null,
          leaderMarkPx: null,
          medianWindowMin: null,
          exitDna: null,
          ownerPosition: null,
        },
      ],
      "https://x.example",
      [
        { coin: "ETH", direction: "long", status: "created", detail: "alert-123" },
        { coin: "xyz:BRENTOIL", direction: "long", status: "skipped", detail: "no resolvable spot token" },
      ],
    );
    expect(msg).toContain("Nansen will also message you directly if Smart Money pulls out of ETH on-chain.");
    expect(msg).not.toContain("skipped");
    expect(msg).not.toContain("xyz:BRENTOIL");
  });
});

describe("smart alert store helpers", () => {
  it("setSmartAlertId records the id under its coin without touching other alarms", () => {
    const record = createAlarmRecord("0xowner", [watch({ coin: "ETH" })]);
    const s: AlarmStore = { [record.code]: record };
    const updated = setSmartAlertId(s, record.code, "ETH", "alert-1");
    expect(updated[record.code].smartAlerts).toEqual({ ETH: "alert-1" });
  });

  it("smartAlertIdsForChat collects ids across every alarm bound to that chat", () => {
    const a = { ...createAlarmRecord("0xowner", [watch({ coin: "ETH" })]), chatId: 555, smartAlerts: { ETH: "alert-1" } };
    const b = { ...createAlarmRecord("0xowner", [watch({ coin: "BTC" })]), chatId: 555, smartAlerts: { BTC: "alert-2" } };
    const c = { ...createAlarmRecord("0xowner", [watch({ coin: "SOL" })]), chatId: 999, smartAlerts: { SOL: "alert-3" } };
    const s: AlarmStore = { [a.code]: a, [b.code]: b, [c.code]: c };
    expect(smartAlertIdsForChat(s, 555).sort()).toEqual(["alert-1", "alert-2"]);
  });
});

describe("buildWhyQuestion", () => {
  it("renders the exact literal template for a real reduce", () => {
    const q = buildWhyQuestion({
      leaderAddress: "0xleader",
      leaderLabel: "Leader One",
      coin: "STRK",
      direction: "long",
      pctClosed: 42.6,
      usdValue: 123_456.7,
      atMs: Date.UTC(2026, 0, 15, 10, 30, 0),
    });
    expect(q).toBe(
      "Hyperliquid wallet 0xleader (Leader One) just reduced its STRK long by 43% (~$123,457) at 2026-01-15T10:30:00.000Z. " +
        "What on-chain context explains Smart Money exiting STRK right now? Answer in under 80 words.",
    );
  });

  it("falls back to a shortened address when there is no label", () => {
    const q = buildWhyQuestion({
      leaderAddress: "0x1234567890abcdef",
      leaderLabel: null,
      coin: "ETH",
      direction: "short",
      pctClosed: 100,
      usdValue: 0,
      atMs: 0,
    });
    expect(q).toContain("(0x1234…cdef)");
  });
});

describe("buildWhyTestQuestion", () => {
  it("never claims a reduce happened", () => {
    const q = buildWhyTestQuestion({ leaderAddress: "0xleader", leaderLabel: "Leader One", coin: "STRK", direction: "long" });
    expect(q).not.toContain("just reduced");
    expect(q).toContain("No reduce has happened yet - this is a test.");
    expect(q).toContain("STRK long");
  });
});

describe("formatWhyAnswer", () => {
  it("appends the tools list when tools were used", () => {
    const msg = formatWhyAnswer(" Smart Money rotated into ETH. ", ["token-god-mode", "smart-money-netflow"]);
    expect(msg).toBe("Smart Money rotated into ETH.\n\nTools used: token-god-mode, smart-money-netflow");
  });

  it("returns just the trimmed answer when no tools were used", () => {
    expect(formatWhyAnswer(" No tools needed. ", [])).toBe("No tools needed.");
  });
});

describe("whyCacheKey", () => {
  it("is stable within the same hour and changes across an hour boundary", () => {
    const hourMs = 3_600_000;
    const base = Date.UTC(2026, 0, 15, 10, 0, 0);
    expect(whyCacheKey("0xleader", "STRK", base)).toBe(whyCacheKey("0xleader", "STRK", base + hourMs - 1));
    expect(whyCacheKey("0xleader", "STRK", base)).not.toBe(whyCacheKey("0xleader", "STRK", base + hourMs));
  });

  it("differs by leader and by coin", () => {
    const at = Date.UTC(2026, 0, 15, 10, 0, 0);
    expect(whyCacheKey("0xleaderA", "STRK", at)).not.toBe(whyCacheKey("0xleaderB", "STRK", at));
    expect(whyCacheKey("0xleader", "STRK", at)).not.toBe(whyCacheKey("0xleader", "ETH", at));
  });
});

describe("readExitDna with exit risk", () => {
  it("leads with the holder risk verdict when the report carries one", () => {
    const base = {
      exitDna: { style: "nuclear", medianClips: 1, firstReduceToFlatMedianMin: 0.5, fullExitAfterFirstReducePct: 100, firstReduceAtPnlPct: null, sample: 3 },
      medianWindowMin: 163,
    } as unknown as WalletReport;
    const withRisk = { ...base, exitRisk: { level: "high", fullExitPct: 100, minutesToFlat: 0.5, medianWindowMin: 163, sample: 3, sentence: "" } } as unknown as WalletReport;
    expect(readExitDna(withRisk)).toMatch(/^Holder risk HIGH\. /);
    expect(readExitDna(base)).not.toMatch(/^Holder risk/);
  });
});
