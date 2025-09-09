// /app/api/attendance/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// GET /api/attendance?date=YYYY-MM-DD&projectId=<uuid-opsional>
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const projectId = searchParams.get("projectId");

  if (!date) {
    return NextResponse.json({ error: "Query ?date=YYYY-MM-DD wajib ada" }, { status: 400 });
  }

  let q = supabaseServer.from("attendance").select("project_id, technician_id, work_date");
  q = q.eq("work_date", date);
  if (projectId) q = q.eq("project_id", projectId);

  const { data, error } = await q;
  if (error) {
    console.error("[GET /api/attendance] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
