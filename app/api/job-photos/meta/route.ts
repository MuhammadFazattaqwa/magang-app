// app/api/job-photos/meta/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServers";

export async function POST(req: Request) {
  try {
    const { jobId, categoryId, serialNumber, meter, ocrStatus } =
      await req.json();
    if (!jobId || !categoryId)
      return NextResponse.json(
        { error: "jobId & categoryId required" },
        { status: 400 }
      );

    const supabase = supabaseServer();

    const payload: any = {
      job_id: jobId,
      category_id: String(categoryId),
      updated_at: new Date().toISOString(),
    };
    if (typeof serialNumber === "string")
      payload.serial_number = serialNumber || null;
    if (typeof meter === "number" || meter === null)
      payload.cable_meter = meter;
    if (typeof ocrStatus === "string") payload.ocr_status = ocrStatus;

    const { error } = await supabase
      .from("job_photos")
      .upsert(payload, { onConflict: "job_id,category_id" });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Meta update failed" },
      { status: 500 }
    );
  }
}
