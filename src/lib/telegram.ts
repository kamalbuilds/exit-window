// Minimal Telegram Bot API client: getMe (cached), sendMessage, getUpdates (long poll).
// Token comes from process.env.TELEGRAM_BOT_TOKEN, read fresh per call, never logged.

function apiBase(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set. Add it to .env (never commit it, never log its value).");
  }
  return `https://api.telegram.org/bot${token}`;
}

let cachedUsername: string | null = null;

/** A bot's username never changes for a given token, so this is cached for the process lifetime -
 * it is called once per /api/alarm request to build the deep link. */
export async function getBotUsername(): Promise<string> {
  if (cachedUsername) return cachedUsername;
  const res = await fetch(`${apiBase()}/getMe`);
  const json = (await res.json()) as { ok: boolean; result?: { username?: string }; description?: string };
  if (!json.ok || !json.result?.username) {
    throw new Error(`Telegram getMe failed: ${json.description ?? res.status}`);
  }
  cachedUsername = json.result.username;
  return cachedUsername;
}

export async function sendMessage(chatId: number | string, text: string): Promise<void> {
  const res = await fetch(`${apiBase()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage ${res.status}`);
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

/** Long-polls for up to `timeoutSec`; Telegram holds the connection open and returns as soon as
 * an update exists, or an empty result at the timeout - the caller loops forever. */
export async function getUpdates(offset: number, timeoutSec = 30): Promise<TelegramUpdate[]> {
  const res = await fetch(`${apiBase()}/getUpdates?offset=${offset}&timeout=${timeoutSec}`);
  if (!res.ok) throw new Error(`Telegram getUpdates ${res.status}`);
  const json = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
  return json.ok ? json.result ?? [] : [];
}
