import { describe, expect, it } from "vitest";
import {
  alarmsForChat,
  bindCode,
  createAlarmRecord,
  dropWatch,
  formatAlarmMessage,
  formatDropMessage,
  ownerStillHolds,
  randomCode,
  shouldFire,
  unbindChat,
  type AlarmStore,
  type Watch,
} from "../src/lib/alarms";
import type { OpenPosition, PositionChange } from "../src/lib/types";

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
  it("names the coin and the leader that is no longer watched", () => {
    const msg = formatDropMessage(watch({ leader: "0x1234567890abcdef" }));
    expect(msg).toBe("You no longer hold ETH. Stopped watching 0x1234…cdef on it.");
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
