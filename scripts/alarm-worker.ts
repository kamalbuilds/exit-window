// Long-running alarm worker: binds Telegram chats to alarm codes, then every 30s reads each
// watched leader's positions from Hyperliquid's public clearinghouseState (free, no Nansen
// credits) and fires a message on any reduce/close/flip of a watched coin+side. Nansen is only
// ever touched once per leader (buildReport, itself cached), never polled in this loop.
// Run with `npm run alarms`.
import {
  alarmsForChat,
  bindCode,
  dropWatch,
  formatAlarmMessage,
  formatDropMessage,
  loadStore,
  ownerStillHolds,
  saveStore,
  shouldFire,
  unbindChat,
} from "@/lib/alarms";
import { diffPositions } from "@/lib/follow";
import { fetchClearinghouseState } from "@/lib/hyperliquid";
import { mirrorChange } from "@/lib/mirror";
import { buildReport } from "@/lib/report";
import { getUpdates, sendMessage } from "@/lib/telegram";
import type { OpenPosition } from "@/lib/types";

const TICK_MS = 30_000;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

const leaderSnapshots = new Map<string, OpenPosition[]>();
const medianWindowByLeader = new Map<string, number | null>();

/** buildReport is cached (report.ts's own reportCache), so this only ever costs Nansen credits
 * the first time a given leader is watched in this process's lifetime. */
async function medianWindowFor(leader: string): Promise<number | null> {
  if (medianWindowByLeader.has(leader)) return medianWindowByLeader.get(leader) ?? null;
  try {
    const report = await buildReport(leader);
    medianWindowByLeader.set(leader, report.medianWindowMin);
    return report.medianWindowMin;
  } catch {
    medianWindowByLeader.set(leader, null);
    return null;
  }
}

async function tick(): Promise<void> {
  let store = await loadStore();
  const active = Object.values(store).filter((r) => r.chatId !== null && r.watches.length > 0);
  if (active.length === 0) return;

  const leaders = [...new Set(active.flatMap((r) => r.watches.map((w) => w.leader)))];
  const owners = [...new Set(active.map((r) => r.owner))];

  const [leaderPositions, ownerPositionEntries] = await Promise.all([
    Promise.all(leaders.map(async (l) => [l, await fetchClearinghouseState(l).catch(() => null)] as const)),
    Promise.all(owners.map(async (o) => [o, await fetchClearinghouseState(o).catch(() => null)] as const)),
  ]);
  const ownerPosByAddr = new Map(ownerPositionEntries);

  for (const [leader, next] of leaderPositions) {
    if (next === null) continue;
    const prev = leaderSnapshots.get(leader) ?? [];
    const changes = diffPositions(prev, next, Date.now());
    leaderSnapshots.set(leader, next);
    if (changes.length === 0) continue;

    for (const record of active) {
      for (const watch of record.watches) {
        if (watch.leader !== leader) continue;
        const change = changes.find((c) => shouldFire(c, watch));
        if (!change || record.chatId === null) continue;

        const medianWindowMin = await medianWindowFor(leader);
        const ownerSize = ownerPosByAddr.get(record.owner)?.find((p) => p.coin === watch.coin)?.size ?? 0;
        const message = formatAlarmMessage({
          leaderLabel: watch.label,
          leaderAddress: leader,
          change,
          medianWindowMin,
          ownerSize,
          appUrl: APP_URL,
        });
        await sendMessage(record.chatId, message).catch((err) => console.error("sendMessage failed:", err.message));
        if (record.mirror) {
          await mirrorChange(change, record.owner).catch((err) => console.error("mirrorChange failed:", err.message));
        }
      }
    }
  }

  // The owner dropped a watched coin: stop watching it and say so.
  for (const record of active) {
    const ownerPos = ownerPosByAddr.get(record.owner);
    if (!ownerPos || record.chatId === null) continue;
    for (const watch of record.watches) {
      if (ownerStillHolds(ownerPos, watch.coin)) continue;
      store = dropWatch(store, record.code, watch.coin);
      await sendMessage(record.chatId, formatDropMessage(watch)).catch((err) => console.error("sendMessage failed:", err.message));
    }
  }

  await saveStore(store);
}

async function pollTelegram(): Promise<void> {
  let offset = 0;
  for (;;) {
    let updates;
    try {
      updates = await getUpdates(offset, 25);
    } catch (err) {
      console.error("getUpdates failed:", err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      const chat = u.message?.chat.id;
      const text = u.message?.text?.trim();
      if (!chat || !text) continue;
      const store = await loadStore();

      if (text.startsWith("/start")) {
        const code = text.split(/\s+/)[1];
        const bound = code ? bindCode(store, code, chat) : null;
        if (!bound) {
          await sendMessage(chat, "Unknown or expired code. Create a new alarm from the app.").catch(() => {});
          continue;
        }
        await saveStore(bound.store);
        const watchList = bound.record.watches.map((w) => `${w.coin} (${w.direction})`).join(", ") || "nothing yet";
        await sendMessage(chat, `Watching: ${watchList}. I'll message you when any of them starts exiting.`).catch(() => {});
      } else if (text.startsWith("/stop")) {
        await saveStore(unbindChat(store, chat));
        await sendMessage(chat, "Stopped. All your alarms are cleared.").catch(() => {});
      } else if (text.startsWith("/list")) {
        const mine = alarmsForChat(store, chat);
        const lines = mine.flatMap((r) => r.watches.map((w) => `${w.leader.slice(0, 6)}…${w.leader.slice(-4)} - ${w.coin} (${w.direction})`));
        await sendMessage(chat, lines.length ? lines.join("\n") : "No active watches.").catch(() => {});
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(`alarm-worker: ticking every ${TICK_MS / 1000}s, polling Telegram`);
  setInterval(() => {
    tick().catch((err) => console.error("tick failed:", err instanceof Error ? err.message : err));
  }, TICK_MS);
  await pollTelegram();
}

main();
