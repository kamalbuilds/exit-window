// Long-running alarm worker: binds Telegram chats to alarm codes, then every 30s reads each
// watched leader's positions from Hyperliquid's public clearinghouseState (free, no Nansen
// credits) and fires a message on any reduce/close/flip of a watched coin+side. Nansen is only
// ever touched once per leader (buildReport, itself cached), never polled in this loop.
// Run with `npm run alarms`.
import {
  alarmsForChat,
  bindCode,
  buildWhyQuestion,
  buildWhyTestQuestion,
  distinctLeaderCount,
  dropWatch,
  effectiveReducePct,
  formatAlarmMessage,
  formatConsensusMessage,
  formatDropMessage,
  formatNearLiquidationMessage,
  formatNearLiquidationStoppedMessage,
  formatOnboardingMessage,
  formatProtectionLine,
  formatTestMessage,
  formatWhyAnswer,
  friendlyNansenError,
  loadStore,
  markHeld,
  nearLiquidationDecision,
  ownerStillHolds,
  pruneRecent,
  randomCode,
  readExitDna,
  saveStore,
  setNearLiquidationState,
  setSmartAlertId,
  shortAddr,
  shouldDropForClose,
  shouldFire,
  shouldNotify,
  smartAlertIdsForChat,
  stopNearLiquidationWatch,
  unbindChat,
  usdValueOf,
  whyCacheKey,
  type RecentReduce,
  type SmartAlertOnboardingInput,
  type Watch,
} from "@/lib/alarms";
import { adverseDistancePct } from "@/lib/forced";
import { diffPositions } from "@/lib/follow";
import { dexPrefix, fetchAllMids, fetchClearinghouseState, fetchMidsForDex } from "@/lib/hyperliquid";
import { createSmartAlert, deleteSmartAlert } from "@/lib/intel";
import { mirrorChange } from "@/lib/mirror";
import { logCall } from "@/lib/nansen";
import { buildReport } from "@/lib/report";
import { answerCallbackQuery, getUpdates, sendMessage, type ReplyMarkup } from "@/lib/telegram";
import type { OpenPosition, WalletReport } from "@/lib/types";

const TICK_MS = 30_000;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

const leaderSnapshots = new Map<string, OpenPosition[]>();

interface ReportSummary {
  medianWindowMin: number | null;
  exitDna: string | null;
  exitRiskHigh: boolean; // report.exitRisk?.level === "high" - what trigger "high_risk" fires on
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
    summary = { medianWindowMin: report.medianWindowMin, exitDna: readExitDna(report), exitRiskHigh: report.exitRisk?.level === "high" };
  } catch {
    summary = { medianWindowMin: null, exitDna: null, exitRiskHigh: false };
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

// ---------------------------------------------------------------------------
// "Why is it exiting?" inline button: Telegram's callback_data is capped at 64 bytes, so each
// fire/test message gets a short random id instead of the full question, backed by this
// in-memory map. Bounded so a long-running process can't grow this unboundedly; a Map preserves
// insertion order, so the oldest entry is always first.
// ---------------------------------------------------------------------------
interface WhyContext {
  leader: string;
  coin: string;
  question: string;
  atMs: number;
}
const whyContexts = new Map<string, WhyContext>();
const WHY_CONTEXT_MAX = 500;

function rememberWhyContext(ctx: WhyContext): string {
  const id = randomCode(8);
  whyContexts.set(id, ctx);
  if (whyContexts.size > WHY_CONTEXT_MAX) {
    const oldest = whyContexts.keys().next().value;
    if (oldest !== undefined) whyContexts.delete(oldest);
  }
  return id;
}

function whyButton(id: string): ReplyMarkup {
  return { inline_keyboard: [[{ text: "Why is it exiting?", callback_data: `why:${id}` }]] };
}

// Cached per (leader, coin, hour) - see whyCacheKey - so the same reduce tapped twice within an
// hour doesn't spend a second Agent call.
const whyAnswerCache = new Map<string, { answer: string; tools: string[] }>();

interface AgentSseEvent {
  type?: string;
  text?: string;
  name?: string;
  tool_calls?: unknown[];
  error?: string;
}

function toolNameOf(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
    return (entry as { name: string }).name;
  }
  return String(entry);
}

/** Manually streams POST /api/v1/agent/fast: nansenCall/rawFetch in nansen.ts always does
 * res.json(), which can't consume a text/event-stream response, so this replicates rawFetch's
 * auth-header pattern directly and parses the SSE body itself. Every call is still recorded in
 * data/nansen-calls.jsonl via the exported logCall, so the invariant "every Nansen call is
 * logged" holds even outside the normal nansenCall wrapper. */
async function askWhyExiting(question: string): Promise<{ answer: string; tools: string[] }> {
  const key = process.env.NANSEN_API_KEY;
  if (!key) throw new Error("NANSEN_API_KEY is not set. Add it to .env (never commit it, never log its value).");

  const start = Date.now();
  const res = await fetch("https://api.nansen.ai/api/v1/agent/fast", {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: question }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    await logCall({
      endpoint: "agent/fast",
      cache: "miss",
      requestSummary: { textLength: question.length },
      method: "POST",
      status: res.status,
      latencyMs: Date.now() - start,
      rows: null,
      rateLimitRemaining: null,
      error: text || `HTTP ${res.status}`,
    });
    throw new Error(`Nansen agent/fast ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  const seenTools = new Set<string>();
  let finishTools: string[] | null = null;
  let streamError: string | null = null;

  readLoop: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of rawEvent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice("data:".length).trim();
        if (data === "[DONE]") break readLoop;
        let evt: AgentSseEvent;
        try {
          evt = JSON.parse(data) as AgentSseEvent;
        } catch {
          continue;
        }
        if (evt.type === "delta" && typeof evt.text === "string") answer += evt.text;
        else if (evt.type === "tool_call" && typeof evt.name === "string") seenTools.add(evt.name);
        else if (evt.type === "finish") finishTools = Array.isArray(evt.tool_calls) ? evt.tool_calls.map(toolNameOf) : null;
        else if (evt.type === "error") streamError = typeof evt.error === "string" ? evt.error : "agent error";
      }
    }
  }

  const tools = finishTools ?? [...seenTools];
  await logCall({
    endpoint: "agent/fast",
    cache: "miss",
    requestSummary: { textLength: question.length },
    method: "POST",
    status: res.status,
    latencyMs: Date.now() - start,
    rows: tools.length,
    rateLimitRemaining: null,
    ...(streamError ? { error: streamError } : {}),
  });

  if (streamError) throw new Error(`Nansen agent/fast stream error: ${streamError}`);
  return { answer, tools };
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
  const leaderPosByAddr = new Map(leaderPositions); // null = this tick's read failed
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

        const { medianWindowMin, exitDna, exitRiskHigh } = await reportSummaryFor(leader);
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

        // Rule gate: a rule-less alarm behaves exactly as before (any watched reduce notifies);
        // a rule's trigger and minReducePct decide whether this particular reduce is worth a
        // message at all, not just whether it matched the watch's coin/direction.
        const notify = shouldNotify(record.rule, watch, change, {
          distinctLeaders: distinctLeaderCount(history),
          leaderExitRiskHigh: exitRiskHigh,
        });
        if (!notify) continue;

        let mirrorResult = null;
        const reducePct = effectiveReducePct(record.rule, watch);
        if (record.mirror || reducePct !== null) {
          const fraction = reducePct !== null ? reducePct / 100 : change.reducedFraction;
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

        // "Why is it exiting?" attaches to every real reduce fire (single-leader or consensus)
        // unless the alarm's rule turned it off, always about the leader/coin that just fired.
        const askAgent = record.rule ? record.rule.askAgent : true;
        let replyMarkup: ReplyMarkup | undefined;
        if (askAgent) {
          const whyQuestion = buildWhyQuestion({
            leaderAddress: leader,
            leaderLabel: watch.label,
            coin: change.coin,
            direction: change.direction,
            pctClosed: change.reducedFraction * 100,
            usdValue,
            atMs: now,
          });
          const whyId = rememberWhyContext({ leader, coin: change.coin, question: whyQuestion, atMs: now });
          replyMarkup = whyButton(whyId);
        }

        await sendMessage(record.chatId, message, undefined, replyMarkup)
          .then(() => messagesSent++)
          .catch((err) => {
            errors++;
            console.error("sendMessage failed:", err instanceof Error ? err.message : err);
          });
      }
    }
  }

  // near_liquidation: a forced-exit risk on the largest watched holder's own liquidation price,
  // not a reduce - so it is checked independently of the diffPositions loop above, every tick, for
  // every alarm carrying that trigger. Hyperliquid-only (this tick's clearinghouseState reads, fetchMidsForDex):
  // zero Nansen calls, matching the credits-exhausted constraint this trigger was built under.
  for (const record of active) {
    const rule = record.rule;
    if (!rule || rule.trigger !== "near_liquidation" || record.chatId === null) continue;
    const withinPct = rule.liqWithinPct ?? 5;

    const byCoin = new Map<string, Watch[]>();
    for (const watch of record.watches) {
      if (watch.nearLiqStopped) continue;
      const group = byCoin.get(watch.coin) ?? [];
      group.push(watch);
      byCoin.set(watch.coin, group);
    }

    for (const [coin, watchesForCoin] of byCoin) {
      const [positionEntries, mids] = await Promise.all([
        // Reuses this tick's clearinghouseState reads: Hyperliquid allows 1200 weight/min per IP, shared
        // with the sentinel. undefined = read failed (unknown), null = holds nothing on this side.
        watchesForCoin.map((w) => {
          const all = leaderPosByAddr.get(w.leader);
          const pos = all ? (all.find((p) => p.coin === coin && p.direction === w.direction) ?? null) : undefined;
          return [w, pos] as const;
        }),
        fetchMidsForDex(dexPrefix(coin)).catch(() => ({}) as Record<string, number>),
      ]);
      const mid: number | null = mids[coin] ?? null;

      // Ranking uses only the live position each leader currently holds - positionValueUsd is
      // never persisted on a Watch (see AlarmRequestWatch's bind-time comment), so "largest" is
      // recomputed fresh every tick rather than read off stale bind-time data.
      let best: { watch: Watch; position: OpenPosition } | null = null;
      let bestValue = -Infinity;
      for (const [watch, position] of positionEntries) {
        if (position === undefined) continue; // read failed this tick: unknown, never "left"
        if (!position) {
          // The leader no longer holds this coin at all. Only worth a message once, and only for
          // a watch this alarm had actually been checking (nearLiqState set means it was, at some
          // earlier tick, this coin's largest live holder).
          if (watch.nearLiqState !== undefined) {
            store = stopNearLiquidationWatch(store, record.code, watch.leader, coin);
            await sendMessage(record.chatId, formatNearLiquidationStoppedMessage(watch.label, watch.leader, coin)).catch((err) => {
              errors++;
              console.error("sendMessage failed:", err instanceof Error ? err.message : err);
            });
          }
          continue;
        }
        const value = usdValueOf(position, mid);
        if (value > bestValue) {
          bestValue = value;
          best = { watch, position };
        }
      }
      if (!best) continue;

      const { watch, position } = best;
      if (position.liquidationPx === null || position.liquidationPx <= 0) {
        console.log(`near_liquidation: no liquidationPx for leader=${watch.leader} coin=${coin}, skipping`);
        continue;
      }
      if (mid === null) {
        console.log(`near_liquidation: no live mid for coin=${coin}, skipping`);
        continue;
      }

      const distancePct = adverseDistancePct(watch.direction, mid, position.liquidationPx);
      const decision = nearLiquidationDecision(watch.nearLiqState, distancePct, withinPct);
      store = setNearLiquidationState(store, record.code, watch.leader, coin, decision.state);
      if (!decision.fire) continue;

      let mirrorResult = null;
      const reducePct = effectiveReducePct(rule, watch);
      // Only an explicit cut action moves money here. record.mirror copies a leader's own reduce, and
      // nearing liquidation is not a reduce, so mirror mode alone must never close the position.
      if (reducePct !== null) {
        const fraction = reducePct / 100;
        mirrorResult = await mirrorChange(
          {
            coin,
            direction: watch.direction,
            kind: "reduce",
            fromSize: position.size,
            toSize: position.size * (1 - fraction),
            reducedFraction: fraction,
            at: Date.now(),
          },
          record.owner,
        ).catch((err) => {
          errors++;
          console.error("mirrorChange failed:", err instanceof Error ? err.message : err);
          return null;
        });
      }
      const protectionLine = mirrorResult ? formatProtectionLine(mirrorResult) : null;

      const ownerSize = ownerPosByAddr.get(record.owner)?.find((p) => p.coin === coin)?.size ?? 0;
      const message = formatNearLiquidationMessage({
        leaderLabel: watch.label,
        leaderAddress: watch.leader,
        coin,
        direction: watch.direction,
        markPx: mid,
        distancePct,
        liquidationPx: position.liquidationPx,
        positionValueUsd: usdValueOf(position, mid),
        ownerSize,
        appUrl: APP_URL,
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

      if (u.callback_query) {
        const cq = u.callback_query;
        // Must answer immediately - before the (potentially slow) agent call - or the tapped
        // button shows an infinite loading spinner.
        await answerCallbackQuery(cq.id).catch((err) =>
          console.error("answerCallbackQuery failed:", err instanceof Error ? err.message : err),
        );
        const cbChat = cq.message?.chat.id;
        const data = cq.data;
        if (!cbChat || !data?.startsWith("why:")) continue;
        const ctx = whyContexts.get(data.slice("why:".length));
        if (!ctx) {
          await sendMessage(cbChat, "This button expired. Trigger a new alert or /test to ask again.").catch(() => {});
          continue;
        }
        const cacheKey = whyCacheKey(ctx.leader, ctx.coin, ctx.atMs);
        let result = whyAnswerCache.get(cacheKey);
        if (!result) {
          try {
            result = await askWhyExiting(ctx.question);
            whyAnswerCache.set(cacheKey, result);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error("askWhyExiting failed:", reason);
            await sendMessage(cbChat, `Could not reach the Nansen agent: ${friendlyNansenError(reason)}`).catch(() => {});
            continue;
          }
        }
        await sendMessage(cbChat, formatWhyAnswer(result.answer, result.tools)).catch((err) =>
          console.error("sendMessage failed:", err instanceof Error ? err.message : err),
        );
        continue;
      }

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
              const created = await createSmartAlert({ code: bound.record.code, coin: w.coin, direction: w.direction });
              store = setSmartAlertId(store, bound.record.code, w.coin, created.id);
              console.log(`smart-alert created: code=${bound.record.code} coin=${w.coin} direction=${w.direction} id=${created.id}`);
              return { coin: w.coin, direction: w.direction, status: "created", detail: created.id };
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              console.error(`smart-alert skipped: code=${bound.record.code} coin=${w.coin} direction=${w.direction} reason=${reason}`);
              return { coin: w.coin, direction: w.direction, status: "skipped", detail: reason };
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

        const message = formatOnboardingMessage(watchInputs, APP_URL, smartAlerts, bound.record.rule);
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
          r.watches.map((w) => `${w.label || shortAddr(w.leader)} - ${w.coin} (${w.direction})`),
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
          // /test must never claim a reduce happened, so its button uses the hypothetical
          // question (buildWhyTestQuestion), not the real-reduce template.
          const testQuestion = buildWhyTestQuestion({
            leaderAddress: watch.leader,
            leaderLabel: watch.label,
            coin: watch.coin,
            direction: watch.direction,
          });
          const whyId = rememberWhyContext({ leader: watch.leader, coin: watch.coin, question: testQuestion, atMs: Date.now() });
          await sendMessage(chat, message, undefined, whyButton(whyId)).catch(() => {});
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
