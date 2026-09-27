import { NextResponse } from "next/server";
import { fetchBuilderFee, NansenAuthError } from "@/lib/nansen";

/** Never echoes key values - only whether they're present, plus the one live fact
 * (builder-fee approval) that actually gates a live mirror order from succeeding. */
export async function GET() {
  const hlKey = process.env.HL_API_WALLET_KEY;
  const hlAddress = process.env.HL_ACCOUNT_ADDRESS;
  const live = !!hlKey && !!hlAddress;

  if (!live) {
    return NextResponse.json({ live: false, builderFeeApproved: false, requiredFeeTenthsBp: null, builderAddress: null });
  }

  try {
    const { data } = await fetchBuilderFee(hlAddress as string);
    return NextResponse.json({
      live: true,
      builderFeeApproved: data.approved,
      requiredFeeTenthsBp: data.requiredFee,
      builderAddress: data.builderAddress,
    });
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "builder-fee check failed";
    return NextResponse.json({ live: true, builderFeeApproved: false, requiredFeeTenthsBp: null, builderAddress: null, error: message });
  }
}
