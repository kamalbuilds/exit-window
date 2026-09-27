import { NextResponse } from "next/server";
import { checkRateLimit, clientIp, joinWaitlist, normalizeAddress, normalizeEmail } from "@/lib/waitlist";

interface WaitlistRequestBody {
  email?: unknown;
  address?: unknown;
}

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "too many requests, try again later" }, { status: 429 });
  }

  let body: WaitlistRequestBody;
  try {
    body = (await req.json()) as WaitlistRequestBody;
  } catch {
    return NextResponse.json({ error: "malformed request body" }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  if (typeof email !== "string") return NextResponse.json(email, { status: 400 });

  const address = normalizeAddress(body?.address);
  if (address !== null && typeof address !== "string") return NextResponse.json(address, { status: 400 });

  const { place, alreadyJoined } = await joinWaitlist(email, address);
  return NextResponse.json({ place, alreadyJoined });
}
