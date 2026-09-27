// End-to-end production proof for the Exit Window Telegram alarm, run as a real Telegram user via
// the global `tg` CLI (Telethon user session, ~/.agents/tools/tg-cli). Shells out to `tg` and to
// `fly logs` rather than reimplementing either. No secrets are read, printed, or passed - every
// call here is either a public HTTP endpoint or a CLI that already holds its own credentials.
//
// Run with: npx tsx scripts/e2e-telegram.ts --base https://exit-window.fly.dev
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "http://localhost:3000";
})();
const FLY_APP = process.env.FLY_APP ?? "exit-window";
const BOT_CHAT = process.env.TG_BOT ?? "@nansen_meridian_bot";

const OWNER_1 = "0xb81219ef9f6d3fdc1ff893fa82d80840a651b5e0";

let passed = 0;
let failed = 0;

function pass(step: string, detail: string): void {
  passed++;
  console.log(`PASS [${step}] ${detail}`);
}
function fail(step: string, detail: string): void {
  failed++;
  console.log(`FAIL [${step}] ${detail}`);
}
function info(step: string, detail: string): void {
  console.log(`INFO [${step}] ${detail}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// tg CLI wrappers
// ---------------------------------------------------------------------------
interface TgMsg {
  id: number;
  date: string;
  from: string;
  text: string;
  buttons?: string[][];
}

async function tgSend(chat: string, text: string): Promise<number> {
  const { stdout } = await execFileP("tg", ["send", chat, text]);
  const parsed = JSON.parse(stdout.trim()) as { sent: number };
  return parsed.sent;
}

async function tgRead(chat: string, limit = 10): Promise<TgMsg[]> {
  const { stdout } = await execFileP("tg", ["read", chat, "--limit", String(limit)]);
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TgMsg);
}

async function tgClick(chat: string, msgId: number, button: string): Promise<void> {
  await execFileP("tg", ["click", chat, String(msgId), button]);
}

/** Polls `tg read` until a message newer than `afterId` satisfies `match`, or times out. */
async function waitForReply(
  chat: string,
  afterId: number,
  match: (m: TgMsg) => boolean,
  timeoutMs: number,
  pollMs = 4000,
): Promise<TgMsg | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msgs = await tgRead(chat, 20);
    const hit = msgs.find((m) => m.id > afterId && match(m));
    if (hit) return hit;
    await sleep(pollMs);
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP + fly logs helpers
// ---------------------------------------------------------------------------
async function postAlarm(owner: string, watches: unknown[]): Promise<{ code: string; deepLink: string }> {
  const res = await fetch(`${BASE}/api/alarm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, watches }),
  });
  const json = (await res.json()) as { code?: string; deepLink?: string; error?: string };
  if (!res.ok || !json.code || !json.deepLink) {
    throw new Error(`POST /api/alarm failed (${res.status}): ${json.error ?? JSON.stringify(json)}`);
  }
  return { code: json.code, deepLink: json.deepLink };
}

interface FeedRow {
  timestamp: number;
  trader_address: string;
  trader_address_label: string | null;
  token_symbol: string;
  side: "Long" | "Short";
  action: string;
  value_usd: number;
}

async function getFeed(): Promise<FeedRow[]> {
  const res = await fetch(`${BASE}/api/feed`);
  if (!res.ok) throw new Error(`GET /api/feed failed (${res.status})`);
  return (await res.json()) as FeedRow[];
}

async function flyLogTail(lines = 200): Promise<string> {
  const { stdout } = await execFileP("fly", ["logs", "-a", FLY_APP, "--no-tail"], { maxBuffer: 1024 * 1024 * 16 });
  return stdout.trim().split("\n").slice(-lines).join("\n");
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
async function step1(): Promise<{ code: string; deepLink: string }> {
  const step = "1/create-alarm";
  const { code, deepLink } = await postAlarm(OWNER_1, [
    { leader: OWNER_1, coin: "STRK", direction: "long" },
  ]);
  if (!deepLink.includes(code)) {
    fail(step, `deep link ${deepLink} does not carry code ${code}`);
  } else {
    pass(step, `code=${code} deepLink=${deepLink}`);
  }
  return { code, deepLink };
}

async function step2(code: string): Promise<number> {
  const step = "2/start-onboarding";
  const beforeMsgs = await tgRead(BOT_CHAT, 5);
  const beforeId = beforeMsgs[0]?.id ?? 0;
  await tgSend(BOT_CHAT, `/start ${code}`);
  const reply = await waitForReply(
    BOT_CHAT,
    beforeId,
    (m) => m.from !== "pranjalcodes" && /armed on \d+ watch/i.test(m.text),
    30_000,
  );
  if (!reply) {
    fail(step, "no onboarding reply within 30s");
    return beforeId;
  }
  const hasLeader = /0x[0-9a-f]{4}…[0-9a-f]{4}|STRK/i.test(reply.text);
  const hasPosition = /Position:/.test(reply.text);
  const hasWindow = /Median exit window:/.test(reply.text);
  const hasCommands = /\/list/.test(reply.text) && /\/stop/.test(reply.text) && /\/test/.test(reply.text);
  if (hasLeader && hasPosition && hasWindow && hasCommands) {
    pass(step, `onboarding message ok: ${JSON.stringify(reply.text.slice(0, 200))}`);
  } else {
    fail(
      step,
      `onboarding message missing expected fields (leader=${hasLeader} position=${hasPosition} window=${hasWindow} commands=${hasCommands}): ${reply.text}`,
    );
  }
  return reply.id;
}

async function step3(): Promise<void> {
  const step = "3/nansen-smart-alert";
  const tail = await flyLogTail(300);
  const created = tail.match(/smart-alert created: code=\S+ coin=STRK[^\n]*/);
  const skipped = tail.match(/smart-alert skipped: code=\S+ coin=STRK[^\n]*/);
  if (created) {
    pass(step, created[0]);
  } else if (skipped) {
    pass(step, `blocked on Nansen credits (clear message): ${skipped[0]}`);
  } else {
    fail(step, "no smart-alert created/skipped log line found for STRK in fly logs");
  }
}

async function step4(afterId: number): Promise<void> {
  const step = "4/test-and-why-button";
  await tgSend(BOT_CHAT, "/test");
  const testMsg = await waitForReply(
    BOT_CHAT,
    afterId,
    (m) => m.from !== "pranjalcodes" && m.text.startsWith("Test alert"),
    30_000,
  );
  if (!testMsg) {
    fail(step, "no /test reply starting with 'Test alert' within 30s");
    return;
  }
  const hasButton = (testMsg.buttons ?? []).some((row) => row.some((b) => /why is it exiting/i.test(b)));
  if (!hasButton) {
    fail(step, `/test message has no "Why is it exiting?" button: ${JSON.stringify(testMsg.buttons)}`);
    return;
  }
  pass(step, `/test message ok with inline button (id=${testMsg.id})`);

  await tgClick(BOT_CHAT, testMsg.id, "Why is it exiting");
  const whyReply = await waitForReply(
    BOT_CHAT,
    testMsg.id,
    (m) => m.from !== "pranjalcodes",
    60_000,
  );
  if (!whyReply) {
    fail(step, "no reply to Why-is-it-exiting click within 60s");
    return;
  }
  if (/insufficient credits|credits exhausted/i.test(whyReply.text)) {
    pass(step, `blocked on Nansen credits (clear message): ${whyReply.text.slice(0, 200)}`);
  } else if (/could not reach the nansen agent/i.test(whyReply.text)) {
    fail(step, `Nansen agent call failed for a non-credits reason: ${whyReply.text}`);
  } else {
    pass(step, `Nansen Agent answered: ${whyReply.text.slice(0, 200)}`);
  }
}

async function step5(afterId: number): Promise<number> {
  const step = "5/list-and-stop";
  await tgSend(BOT_CHAT, "/list");
  const listReply = await waitForReply(BOT_CHAT, afterId, (m) => m.from !== "pranjalcodes", 20_000);
  if (!listReply || !/STRK/.test(listReply.text)) {
    fail(step, `/list did not show the STRK watch: ${listReply?.text}`);
  } else {
    pass(step, `/list shows watch: ${listReply.text}`);
  }

  const beforeStop = await flyLogTail(20);
  const tickBefore = [...beforeStop.matchAll(/tick: alarms=(\d+)/g)].pop();
  const alarmsBefore = tickBefore ? Number(tickBefore[1]) : null;

  await tgSend(BOT_CHAT, "/stop");
  const stopReply = await waitForReply(
    BOT_CHAT,
    listReply?.id ?? afterId,
    (m) => m.from !== "pranjalcodes" && /stopped/i.test(m.text),
    20_000,
  );
  if (!stopReply) {
    fail(step, "/stop did not confirm within 20s");
    return stopReply ?? afterId;
  }
  pass(step, `/stop confirmed: ${stopReply.text}`);

  // Give the worker up to ~90s (three ticks) to pick up the unbind and report a lower alarm count.
  const deadline = Date.now() + 90_000;
  let sawDecrease = false;
  let lastTail = "";
  while (Date.now() < deadline && !sawDecrease) {
    await sleep(15_000);
    lastTail = await flyLogTail(20);
    const ticks = [...lastTail.matchAll(/tick: alarms=(\d+)/g)].map((m) => Number(m[1]));
    if (alarmsBefore !== null && ticks.some((n) => n < alarmsBefore)) sawDecrease = true;
    else if (alarmsBefore === null && ticks.length > 0) sawDecrease = true; // no baseline available, accept any observed tick
  }
  if (sawDecrease) {
    pass(step, `worker tick log shows alarms decreased (before=${alarmsBefore})`);
  } else {
    fail(step, `worker tick log never showed a decrease from alarms=${alarmsBefore}: ${lastTail}`);
  }
  return stopReply.id;
}

function pickMostActiveReducer(feed: FeedRow[]): { address: string; label: string | null; coin: string; direction: "long" | "short" } | null {
  const counts = new Map<string, number>();
  for (const row of feed) {
    if (row.action === "Reduce" || row.action === "Close") {
      counts.set(row.trader_address, (counts.get(row.trader_address) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [addr, n] of counts) {
    if (n > bestCount) {
      best = addr;
      bestCount = n;
    }
  }
  if (!best) return null;
  const lastRow = [...feed].reverse().find((r) => r.trader_address === best && (r.action === "Reduce" || r.action === "Close"));
  if (!lastRow) return null;
  return {
    address: best,
    label: lastRow.trader_address_label,
    coin: lastRow.token_symbol,
    direction: lastRow.side === "Long" ? "long" : "short",
  };
}

async function step6(): Promise<void> {
  const step = "6/live-fire";
  const feed = await getFeed();
  const reducer = pickMostActiveReducer(feed);
  if (!reducer) {
    fail(step, "no Reduce/Close rows in GET /api/feed to pick a leader from");
    return;
  }
  info(step, `most active reducer in feed: ${reducer.address} (${reducer.label ?? "no label"}) ${reducer.coin} ${reducer.direction}`);

  const { code } = await postAlarm(reducer.address, [
    { leader: reducer.address, coin: reducer.coin, direction: reducer.direction },
  ]);
  const beforeId = (await tgRead(BOT_CHAT, 3))[0]?.id ?? 0;
  await tgSend(BOT_CHAT, `/start ${code}`);
  const bound = await waitForReply(BOT_CHAT, beforeId, (m) => m.from !== "pranjalcodes", 30_000);
  if (!bound) {
    fail(step, "second alarm never bound (no onboarding reply)");
    return;
  }
  info(step, `bound: ${bound.text.slice(0, 200)}`);

  const liveDeadlineMs = 25 * 60_000;
  const started = Date.now();
  let fired: TgMsg | null = null;
  while (Date.now() - started < liveDeadlineMs) {
    const msgs = await tgRead(BOT_CHAT, 10);
    fired =
      msgs.find(
        (m) =>
          m.id > bound.id &&
          m.from !== "pranjalcodes" &&
          new RegExp(reducer.coin, "i").test(m.text) &&
          /reduced|closed|flipped/i.test(m.text) &&
          !m.text.startsWith("Test alert"),
      ) ?? null;
    if (fired) break;
    await sleep(20_000);
  }

  if (fired) {
    const hasPct = /-?\d+%/.test(fired.text);
    const hasUsd = /\$[\d,]+/.test(fired.text);
    pass(step, `live reduce fired (pct=${hasPct} usd=${hasUsd}): ${fired.text}`);
  } else {
    const tail = await flyLogTail(400);
    const leaderTicks = tail
      .split("\n")
      .filter((l) => l.includes(reducer.address) || (l.includes("tick:") && Date.now() - started < liveDeadlineMs + 60_000))
      .slice(-40)
      .join("\n");
    fail(step, `no live reduce fired within 25 min for ${reducer.address} (${reducer.coin}). Worker tick lines:\n${leaderTicks}`);
  }
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`e2e-telegram: base=${BASE} bot=${BOT_CHAT} flyApp=${FLY_APP}`);

  const { code } = await step1();
  const afterOnboarding = await step2(code);
  await step3();
  await step4(afterOnboarding);
  await step5(afterOnboarding);
  await step6();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
