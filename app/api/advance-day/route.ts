import { NextRequest, NextResponse } from "next/server";
import { effectiveWIBDate } from "@/lib/wib";

export async function POST(req: NextRequest) {
  const { date } = await req.json().catch(() => ({ date: null }));
  const effective = effectiveWIBDate();
  return NextResponse.json({
    data: {
      acknowledged: true,
      requestedDate: date,
      effectiveWIBDate: effective,
      note: "Rollover harian mengikuti 00:05 WIB.",
    },
  });
}
