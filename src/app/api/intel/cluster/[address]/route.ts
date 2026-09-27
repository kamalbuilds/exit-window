import { NextResponse } from "next/server";
import { fetchWalletCluster } from "@/lib/intel";
import { NansenAuthError } from "@/lib/nansen";

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  try {
    const cluster = await fetchWalletCluster(address);
    return NextResponse.json(cluster);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "cluster lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
