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

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface ReplyMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  parseMode?: "HTML",
  replyMarkup?: ReplyMarkup,
): Promise<void> {
  const res = await fetch(`${apiBase()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage ${res.status}`);
}

/** Must be called immediately on every callback_query, even before doing any slow work - until
 * this is called the tapped button shows a loading spinner in the client. */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const res = await fetch(`${apiBase()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
  });
  if (!res.ok) throw new Error(`Telegram answerCallbackQuery ${res.status}`);
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

/** Long-polls for up to `timeoutSec`; Telegram holds the connection open and returns as soon as
 * an update exists, or an empty result at the timeout - the caller loops forever. */
export async function getUpdates(offset: number, timeoutSec = 30): Promise<TelegramUpdate[]> {
  const res = await fetch(`${apiBase()}/getUpdates?offset=${offset}&timeout=${timeoutSec}`);
  if (!res.ok) throw new Error(`Telegram getUpdates ${res.status}`);
  const json = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
  return json.ok ? json.result ?? [] : [];
}
