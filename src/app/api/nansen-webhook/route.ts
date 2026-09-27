// Nansen Smart Alert delivery: Nansen POSTs here (channel type "webhook", set up in
// src/lib/intel.ts's createSmartAlert) instead of its own broken "telegram" channel, which 400s
// because the user never started Nansen's own bot. Every request must carry a valid
// X-Nansen-Signature (HMAC-SHA256 of the raw body, our shared NANSEN_WEBHOOK_SECRET) or it's
// rejected - this is an unauthenticated public endpoint otherwise, so the signature is the only
// thing standing between "did Nansen say this" and "anyone on the internet said this".
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { loadStore, type AlarmRecord, type Watch } from "@/lib/alarms";
import { fetchClearinghouseState } from "@/lib/hyperliquid";
import { sendMessage } from "@/lib/telegram";

/** Pure: constant-time signature check so a byte-by-byte timing side channel can't be used to
 * forge a valid signature. Buffers of different lengths would throw inside timingSafeEqual
 * rather than compare false, so the length check happens first. */
export function verifyNansenSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const provided = header.startsWith("sha256=") ? header.slice("sha256=".length) : header;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length !== expectedBuf.length || providedBuf.length === 0) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

function firstString(payload: Record<string, unknown>, paths: string[]): string | null {
  for (const p of paths) {
    const parts = p.split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
      else {
        cur = undefined;
        break;
      }
    }
    if (typeof cur === "string" && cur.trim() !== "") return cur;
    if (typeof cur === "number") return String(cur);
  }
  return null;
}

function firstNumber(payload: Record<string, unknown>, paths: string[]): number | null {
  for (const p of paths) {
    const parts = p.split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
      else {
        cur = undefined;
        break;
      }
    }
    if (typeof cur === "number" && Number.isFinite(cur)) return cur;
    if (typeof cur === "string" && cur.trim() !== "" && Number.isFinite(Number(cur))) return Number(cur);
  }
  return null;
}

const ALERT_ID_PATHS = ["alertId", "alert_id", "id", "data.alertId", "data.alert_id", "data.id"];
const COIN_PATHS = ["coin", "symbol", "token", "tokenSymbol", "token_symbol", "data.coin", "data.symbol", "data.tokenSymbol"];

/** Pure: figures out which watched coin this delivery is about. Nansen's docs describe the
 * create-request/channel schema but not the actual delivery payload body, so this tries the most
 * reliable signal first (the alert id we stored on create, via setSmartAlertId) and only falls
 * back to guessing a coin/symbol field, then finally the sole watch if there's only one. */
export function resolveWatchForPayload(
  record: AlarmRecord,
  payload: Record<string, unknown>,
): { watch: Watch; coin: string } | null {
  const alertId = firstString(payload, ALERT_ID_PATHS);
  if (alertId && record.smartAlerts) {
    const coin = Object.entries(record.smartAlerts).find(([, id]) => id === alertId)?.[0];
    if (coin) {
      const watch = record.watches.find((w) => w.coin === coin);
      if (watch) return { watch, coin };
    }
  }

  const coinField = firstString(payload, COIN_PATHS);
  if (coinField) {
    const watch = record.watches.find((w) => w.coin.toLowerCase() === coinField.toLowerCase());
    if (watch) return { watch, coin: watch.coin };
  }

  if (record.watches.length === 1) {
    return { watch: record.watches[0], coin: record.watches[0].coin };
  }
  return null;
}

const AMOUNT_PATHS = [
  "amountUsd",
  "amount_usd",
  "usdValue",
  "usd_value",
  "value",
  "outflow",
  "outflowUsd",
  "data.amountUsd",
  "data.amount_usd",
  "data.value",
];

const EXTRA_FIELDS: { label: string; paths: string[] }[] = [
  { label: "alert", paths: ["alertName", "name", "data.name"] },
  { label: "chain", paths: ["chain", "data.chain"] },
  { label: "window", paths: ["timeWindow", "time_window", "data.timeWindow"] },
  { label: "tx", paths: ["txHash", "tx_hash", "data.txHash", "data.tx_hash"] },
  { label: "at", paths: ["triggeredAt", "timestamp", "data.triggeredAt", "data.timestamp"] },
];

/** Pure: the coordinator's literal message template, plus whichever extra fields this delivery
 * actually carries. Plain text (no HTML parse_mode) on purpose - payload comes from an external
 * webhook body, so it's never trusted enough to reflect into an HTML-mode message. */
export function formatSmartAlertMessage(input: {
  coin: string;
  direction: Watch["direction"];
  ownerSize: number;
  payload: Record<string, unknown>;
}): string {
  const { coin, direction, ownerSize, payload } = input;
  const amount = firstNumber(payload, AMOUNT_PATHS);
  const amountText = amount === null ? "an unspecified amount" : `$${Math.round(amount).toLocaleString("en-US")}`;
  let msg =
    `Nansen Smart Alert: Smart Money pulled ${amountText} of ${coin} out on-chain in the last 15m. ` +
    `You hold ${ownerSize} ${coin} ${direction}.`;

  const extras: string[] = [];
  for (const field of EXTRA_FIELDS) {
    const value = firstString(payload, field.paths);
    if (value) extras.push(`${field.label}: ${value}`);
  }
  if (extras.length > 0) msg += `\n${extras.join(", ")}`;
  return msg;
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("alarm");
  if (!code) return NextResponse.json({ error: "missing ?alarm=" }, { status: 400 });

  const secret = process.env.NANSEN_WEBHOOK_SECRET;
  if (!secret) {
    console.error("nansen-webhook: NANSEN_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-nansen-signature");
  if (!verifyNansenSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const store = await loadStore();
  const record = store[code];
  if (!record || record.chatId === null) {
    return NextResponse.json({ error: "unknown or unbound alarm code" }, { status: 404 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = rawBody.trim() === "" ? {} : (JSON.parse(rawBody) as Record<string, unknown>);
  } catch {
    payload = {};
  }

  const resolved = resolveWatchForPayload(record, payload);
  if (!resolved) {
    return NextResponse.json({ error: "could not match this delivery to a watched coin" }, { status: 404 });
  }

  const ownerPositions = await fetchClearinghouseState(record.owner).catch(() => []);
  const ownerSize = ownerPositions.find((p) => p.coin === resolved.coin)?.size ?? 0;

  const message = formatSmartAlertMessage({
    coin: resolved.coin,
    direction: resolved.watch.direction,
    ownerSize,
    payload,
  });

  await sendMessage(record.chatId, message).catch((err) => {
    console.error("nansen-webhook: sendMessage failed:", err instanceof Error ? err.message : err);
  });

  return NextResponse.json({ ok: true });
}
