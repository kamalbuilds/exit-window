// Long-running alarm worker: binds Telegram chats to alarm codes, then every 30s reads each
// watched leader's positions from Hyperliquid's public clearinghouseState (free, no Nansen
// credits) and fires a message on any reduce/close/flip of a watched coin+side. Nansen is only
// ever touched once per leader (buildReport, itself cached), never polled in this loop.
// Run with `npm run alarms`.
import {
  alarmsForChat,
  bindCode,
  distinctLeaderCount,
  dropWatch,
  formatAlarmMessage,
  formatConsensusMessage,
  formatDropMessage,
  formatOnboardingMessage,
  formatProtectionLine,
  formatTestMessage,
  loadStore,
  markHeld,
  ownerStillHolds,
  pruneRecent,
  readExitDna,
  saveStore,
  setSmartAlertId,
  shouldDropForClose,
  shouldFire,
  smartAlertIdsForChat,
  unbindChat,
  type RecentReduce,
  type SmartAlertOnboardingInput,
  type Watch,
} from "@/lib/alarms";
import { diffPositions } from "@/lib/follow";
import { fetchAllMids, fetchClearinghouseState } from "@/lib/hyperliquid";
import { createSmartAlert, deleteSmartAlert } from "@/lib/intel";
import { mirrorChange } from "@/lib/mirror";
import { buildReport } from "@/lib/report";
import { getUpdates, sendMessage } from "@/lib/telegram";
import type { OpenPosition, WalletReport } from "@/lib/types";

const TICK_MS = 30_000;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

const leaderSnapshots = new Map<string, OpenPosition[]>();

interface ReportSummary {
  medianWindowMin: number | null;
  exitDna: string | null;
}
const reportSummaryByLeader = new Map<string, ReportSummary>();

/** buildReport is cached (report.ts's own reportCache), and this map memoizes on top of that
 * for the process lifetime, so a given leader's report is ever built at most once per process -
 * both the tick loop and /start onboarding read through this same function. */
async function reportSummaryFor(leader: string): Promise<ReportSummary> {
  if (reportSummaryByLeader.has(leader)) return reportSummaryByLeader.get(leader) as ReportSummary;
  let summary: ReportSummary;
  try {
    const report: WalletReport = await buildReport(leader);
    summary = { medianWindowMin: report.medianWindowMin, exitDna: readExitDna(report) };
  } catch {
    summary = { medianWindowMin: null, exitDna: null };
  }
  reportSummaryByLeader.set(leader, summary);
  return summary;
}

// Reduce history per `${code}::${coin}::${direction}`, for the consensus alert.
const recentReducesByGroup = new Map<string, RecentReduce[]>();

function pushRecentReduce(groupKey: string, entry: RecentReduce, now: number): RecentReduce[] {
  const pruned = pruneRecent(recentReducesByGroup.get(groupKey) ?? [], now);
  pruned.push(entry);
  recentReducesByGroup.set(groupKey, pruned);
  return pruned;
}

async function tick(): Promise<void> {
  let store = await loadStore();
  const active = Object.values(store).filter((r) => r.chatId !== null && r.watches.length > 0);

  let leadersPolled = 0;
  let changesDetected = 0;
  let messagesSent = 0;
  let errors = 0;

  if (active.length === 0) {
    console.log(`tick: alarms=0 leaders=0 changes=0 sent=0 errors=0`);
    return;
  }

  const leaders = [...new Set(active.flatMap((r) => r.watches.map((w) => w.leader)))];
  const owners = [...new Set(active.map((r) => r.owner))];

  const [leaderPositions, ownerPositionEntries] = await Promise.all([
    Promise.all(leaders.map(async (l) => [l, await fetchClearinghouseState(l).catch(() => null)] as const)),
    Promise.all(owners.map(async (o) => [o, await fetchClearinghouseState(o).catch(() => null)] as const)),
  ]);
  const ownerPosByAddr = new Map(ownerPositionEntries);
  const mids = await fetchAllMids().catch(() => ({}) as Record<string, number>);

  for (const [leader, next] of leaderPositions) {
    leadersPolled++;
    if (next === null) {
      errors++;
      continue;
    }
    const prev = leaderSnapshots.get(leader) ?? [];
    const changes = diffPositions(prev, next, Date.now());
    leaderSnapshots.set(leader, next);
    if (changes.length === 0) continue;

    for (const record of active) {
      for (const watch of record.watches) {
        if (watch.leader !== leader) continue;
        const change = changes.find((c) => shouldFire(c, watch));
        if (!change || record.chatId === null) continue;
        changesDetected++;
        console.log(
          `reduce: leader=${leader} coin=${change.coin} from=${change.fromSize} to=${change.toSize}`,
        );

        const { medianWindowMin, exitDna } = await reportSummaryFor(leader);
        const ownerSize = ownerPosByAddr.get(record.owner)?.find((p) => p.coin === watch.coin)?.size ?? 0;
        const price = mids[change.coin] ?? 0;
        const usdValue = Math.abs(change.fromSize - change.toSize) * price;
        const now = Date.now();

        const groupKey = `${record.code}::${change.coin}::${change.direction}`;
        const history = pushRecentReduce(
          groupKey,
          {
            leader,
            label: watch.label,
            pctClosed: change.reducedFraction * 100,
            usdValue,
            medianWindowMin,
            exitDna,
            at: now,
          },
          now,
        );

        let mirrorResult = null;
        if (record.mirror || watch.protect) {
          const fraction = watch.protect ? watch.protect.reducePct / 100 : change.reducedFraction;
          mirrorResult = await mirrorChange({ ...change, reducedFraction: fraction }, record.owner).catch((err) => {
            errors++;
            console.error("mirrorChange failed:", err instanceof Error ? err.message : err);
            return null;
          });
        }
        const protectionLine = mirrorResult ? formatProtectionLine(mirrorResult) : null;

        const totalWatched = record.watches.filter(
          (w) => w.coin === change.coin && w.direction === change.direction,
        ).length;

        const message =
          distinctLeaderCount(history) > 1
            ? formatConsensusMessage({
                coin: change.coin,
                direction: change.direction,
                totalWatched,
                events: history,
                ownerSize,
                appUrl: APP_URL,
                protectionLine,
              })
            : formatAlarmMessage({
                leaderLabel: watch.label,
                leaderAddress: leader,
                change,
                medianWindowMin,
                ownerSize,
                appUrl: APP_URL,
                exitDna,
                protectionLine,
              });

        await sendMessage(record.chatId, message)
          .then(() => messagesSent++)
          .catch((err) => {
            errors++;
            console.error("sendMessage failed:", err instanceof Error ? err.message : err);
          });
      }
    }
  }

  // Owner-close tracking: mark held while holding, only drop once held-then-fully-closed - never
  // drop just because the owner didn't hold the coin yet at bind time.
  for (const record of active) {
    const ownerPos = ownerPosByAddr.get(record.owner);
    if (!ownerPos || record.chatId === null) continue;
    for (const watch of record.watches) {
      const holdsNow = ownerStillHolds(ownerPos, watch.coin);
      if (holdsNow) {
        store = markHeld(store, record.code, watch.coin);
        continue;
      }
      if (shouldDropForClose(watch, holdsNow)) {
        store = dropWatch(store, record.code, watch.coin);
        await sendMessage(record.chatId, formatDropMessage(watch)).catch((err) => {
          errors++;
          console.error("sendMessage failed:", err instanceof Error ? err.message : err);
        });
      }
    }
  }

  await saveStore(store);
  console.log(
    `tick: alarms=${active.length} leaders=${leadersPolled} changes=${changesDetected} sent=${messagesSent} errors=${errors}`,
  );
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
      let store = await loadStore();

      if (text.startsWith("/start")) {
        const code = text.split(/\s+/)[1];
        const bound = code ? bindCode(store, code, chat) : null;
        if (!bound) {
          await sendMessage(chat, "Unknown or expired code. Create a new alarm from the app.").catch(() => {});
          continue;
        }
        store = bound.store;

        // One Nansen smart alert per distinct coin+direction in this alarm, delivered by Nansen
        // straight to the same chat. Never more than one create call per coin: this loop dedupes
        // via the Map before ever calling createSmartAlert.
        const byCoinDirection = new Map<string, Watch>();
        for (const w of bound.record.watches) byCoinDirection.set(`${w.coin}:${w.direction}`, w);
        const smartAlerts: SmartAlertOnboardingInput[] = await Promise.all(
          [...byCoinDirection.values()].map(async (w): Promise<SmartAlertOnboardingInput> => {
            try {
              const created = await createSmartAlert({ chatId: String(chat), coin: w.coin, direction: w.direction });
              store = setSmartAlertId(store, bound.record.code, w.coin, created.id);
              return { coin: w.coin, direction: w.direction, status: "created", detail: created.id };
            } catch (err) {
              return {
                coin: w.coin,
                direction: w.direction,
                status: "skipped",
                detail: err instanceof Error ? err.message : String(err),
              };
            }
          }),
        );
        await saveStore(store);

        const watchInputs = await Promise.all(
          bound.record.watches.map(async (watch) => {
            const [leaderPositions, ownerPositions, summary] = await Promise.all([
              fetchClearinghouseState(watch.leader).catch(() => [] as OpenPosition[]),
              fetchClearinghouseState(bound.record.owner).catch(() => [] as OpenPosition[]),
              reportSummaryFor(watch.leader),
            ]);
            const mids = await fetchAllMids().catch(() => ({}) as Record<string, number>);
            return {
              watch,
              leaderPosition: leaderPositions.find((p) => p.coin === watch.coin) ?? null,
              leaderMarkPx: mids[watch.coin] ?? null,
              medianWindowMin: summary.medianWindowMin,
              exitDna: summary.exitDna,
              ownerPosition: ownerPositions.find((p) => p.coin === watch.coin) ?? null,
            };
          }),
        );

        const message = formatOnboardingMessage(watchInputs, APP_URL, smartAlerts);
        await sendMessage(chat, message, "HTML").catch(() => {});
      } else if (text.startsWith("/stop")) {
        const alertIds = smartAlertIdsForChat(store, chat);
        await Promise.all(
          alertIds.map((id) =>
            deleteSmartAlert(id).catch((err) =>
              console.error("deleteSmartAlert failed:", err instanceof Error ? err.message : err),
            ),
          ),
        );
        await saveStore(unbindChat(store, chat));
        await sendMessage(chat, "Stopped. All your alarms are cleared.").catch(() => {});
      } else if (text.startsWith("/list")) {
        const mine = alarmsForChat(store, chat);
        const lines = mine.flatMap((r) =>
          r.watches.map((w) => `${w.leader.slice(0, 6)}…${w.leader.slice(-4)} - ${w.coin} (${w.direction})`),
        );
        await sendMessage(chat, lines.length ? lines.join("\n") : "No active watches.").catch(() => {});
      } else if (text.startsWith("/test")) {
        const mine = alarmsForChat(store, chat);
        const watches = mine.flatMap((r) => r.watches);
        if (watches.length === 0) {
          await sendMessage(chat, "No active watches to test. Create an alarm from the app first.").catch(() => {});
          continue;
        }
        for (const watch of watches) {
          const [leaderPositions, summary] = await Promise.all([
            fetchClearinghouseState(watch.leader).catch(() => [] as OpenPosition[]),
            reportSummaryFor(watch.leader),
          ]);
          const message = formatTestMessage({
            watch,
            leaderPosition: leaderPositions.find((p) => p.coin === watch.coin) ?? null,
            medianWindowMin: summary.medianWindowMin,
            appUrl: APP_URL,
          });
          await sendMessage(chat, message).catch(() => {});
        }
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
