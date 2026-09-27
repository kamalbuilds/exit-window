import { NextResponse } from "next/server";
import { createSmartAlert, deleteSmartAlert } from "@/lib/intel";
import { NansenAuthError } from "@/lib/nansen";
import type { Direction } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    chatId?: string;
    coin?: string;
    direction?: string;
  };
  const { chatId, coin, direction } = body;
  // Never create an alert without an explicit chatId: it delivers straight to that Telegram chat.
  if (!chatId) return NextResponse.json({ error: "chatId is required" }, { status: 400 });
  if (!coin) return NextResponse.json({ error: "coin is required" }, { status: 400 });
  if (direction !== "long" && direction !== "short") {
    return NextResponse.json({ error: "direction must be 'long' or 'short'" }, { status: 400 });
  }
  try {
    const created = await createSmartAlert({ chatId, coin, direction: direction as Direction });
    return NextResponse.json(created);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "smart alert creation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "query param id is required" }, { status: 400 });
  try {
    await deleteSmartAlert(id);
    return NextResponse.json({ deleted: id });
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "smart alert deletion failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
