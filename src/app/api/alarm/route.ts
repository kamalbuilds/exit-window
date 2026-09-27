import { NextResponse } from "next/server";
import { createAlarmRecord, loadStore, saveStore, type Watch } from "@/lib/alarms";
import { getBotUsername } from "@/lib/telegram";
import type { AlarmCreated, Direction } from "@/lib/types";

interface AlarmRequestWatch {
  leader: string;
  coin: string;
  direction: Direction;
  label?: string | null;
  protect?: { reducePct: number } | null;
}

interface AlarmRequestBody {
  owner: string;
  watches: AlarmRequestWatch[];
  mirror?: boolean;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AlarmRequestBody;
    if (!body?.owner || !Array.isArray(body.watches) || body.watches.length === 0) {
      return NextResponse.json({ error: "owner and at least one watch are required" }, { status: 400 });
    }
    const watches: Watch[] = body.watches.map((w) => ({
      leader: w.leader,
      coin: w.coin,
      direction: w.direction,
      label: w.label ?? null,
      protect:
        w.protect && Number.isFinite(w.protect.reducePct) && w.protect.reducePct >= 1 && w.protect.reducePct <= 100
          ? { reducePct: w.protect.reducePct }
          : null,
    }));
    const record = createAlarmRecord(body.owner, watches);
    if (body.mirror) record.mirror = true;

    const store = await loadStore();
    store[record.code] = record;
    await saveStore(store);

    const username = await getBotUsername();
    const result: AlarmCreated = { code: record.code, deepLink: `https://t.me/${username}?start=${record.code}` };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "alarm creation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
