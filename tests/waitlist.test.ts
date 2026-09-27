// Waitlist join, dedupe and rate limit. Store is pointed at a fresh temp file per test via
// WAITLIST_STORE so tests never touch data/waitlist.jsonl.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  clientIp,
  joinWaitlist,
  normalizeAddress,
  normalizeEmail,
  resetRateLimit,
} from "../src/lib/waitlist";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "waitlist-test-"));
  process.env.WAITLIST_STORE = path.join(dir, "waitlist.jsonl");
  resetRateLimit();
});

afterEach(async () => {
  delete process.env.WAITLIST_STORE;
  await rm(dir, { recursive: true, force: true });
});

describe("normalizeEmail", () => {
  it("rejects a malformed email", () => {
    const result = normalizeEmail("not-an-email");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("trims and lowercases a valid email", () => {
    expect(normalizeEmail("  Trader@Example.com  ")).toBe("trader@example.com");
  });

  it("rejects an email over the max length", () => {
    const long = "a".repeat(250) + "@x.co";
    const result = normalizeEmail(long);
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("normalizeAddress", () => {
  it("accepts a valid Hyperliquid address", () => {
    const addr = "0x" + "a".repeat(40);
    expect(normalizeAddress(addr)).toBe(addr);
  });

  it("rejects a bad address", () => {
    const result = normalizeAddress("0xnothex");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("treats a missing address as null", () => {
    expect(normalizeAddress(undefined)).toBeNull();
    expect(normalizeAddress("")).toBeNull();
  });
});

describe("joinWaitlist", () => {
  it("dedupes by email and returns the original place", async () => {
    const first = await joinWaitlist("trader@example.com", null);
    expect(first.alreadyJoined).toBe(false);
    const second = await joinWaitlist("other@example.com", null);
    expect(second.place).toBe(first.place + 1);
    const repeat = await joinWaitlist("trader@example.com", "0x" + "b".repeat(40));
    expect(repeat.alreadyJoined).toBe(true);
    expect(repeat.place).toBe(first.place);
  });

  it("gives two concurrent joins distinct sequential places", async () => {
    const [a, b] = await Promise.all([
      joinWaitlist("concurrent-a@example.com", null),
      joinWaitlist("concurrent-b@example.com", null),
    ]);
    expect(a.place).not.toBe(b.place);
    expect([a.place, b.place].sort()).toEqual([1, 2]);
  });
});

describe("rate limit", () => {
  it("trips at the 6th call within the window", () => {
    const ip = "1.2.3.4";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip)).toBe(true);
    }
    expect(checkRateLimit(ip)).toBe(false);
  });
});

describe("clientIp", () => {
  it("trusts fly-client-ip over a client-supplied x-forwarded-for", () => {
    const headers = new Headers({ "fly-client-ip": "8.8.8.8", "x-forwarded-for": "9.9.9.9, 7.7.7.7" });
    expect(clientIp(headers)).toBe("8.8.8.8");
  });

  it("without fly-client-ip, uses the proxy-appended last hop, not the spoofable first", () => {
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" });
    expect(clientIp(headers)).toBe("1.1.1.1");
  });
});
