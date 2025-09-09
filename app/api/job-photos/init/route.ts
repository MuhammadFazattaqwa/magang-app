// app/api/job-photos/init/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { jobId } = await req.json().catch(() => ({}));
    if (!jobId)
      return NextResponse.json({ error: "jobId required" }, { status: 400 });

    // Tidak membuat row apa pun. Hanya no-op agar kompatibel dengan UI.
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Init failed" },
      { status: 500 }
    );
  }
}
