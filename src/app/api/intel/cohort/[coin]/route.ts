import { NextResponse } from "next/server";
import { fetchCohortIntel } from "@/lib/intel";
import { NansenAuthError, NansenCreditsError } from "@/lib/nansen";

export async function GET(_req: Request, { params }: { params: Promise<{ coin: string }> }) {
  const { coin } = await params;
  try {
    const cohort = await fetchCohortIntel(decodeURIComponent(coin));
    return NextResponse.json(cohort);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    // Nothing cached for this coin and nothing to pay with: the page hides the cohort bar.
    if (err instanceof NansenCreditsError) return NextResponse.json({ available: false });
    const message = err instanceof Error ? err.message : "cohort lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
