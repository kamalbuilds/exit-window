import { NextResponse } from "next/server";
import { getLedger } from "@/lib/nansen";

export async function GET() {
  return NextResponse.json(getLedger());
}
