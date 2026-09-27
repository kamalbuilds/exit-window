import { NextResponse } from "next/server";
import { mirrorChange } from "@/lib/mirror";
import { NansenAuthError } from "@/lib/nansen";
import type { PositionChange } from "@/lib/types";

interface MirrorRequestBody {
  leader: string;
  change: PositionChange;
}

export async function POST(req: Request) {
  let body: MirrorRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.change || typeof body.change !== "object") {
    return NextResponse.json({ error: "Missing required field: change" }, { status: 400 });
  }

  try {
    const followerAddress = process.env.HL_ACCOUNT_ADDRESS ?? null;
    const result = await mirrorChange(body.change, followerAddress);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "mirror failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
