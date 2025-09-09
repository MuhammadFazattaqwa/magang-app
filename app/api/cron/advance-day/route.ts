import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { effectiveWIBDate } from "@/lib/wib";

const addDays = (iso: string, d: number) => {
  const [y, m, da] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, da || 1);
  dt.setDate(dt.getDate() + d);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
};

export async function POST(req: NextRequest) {
  // optional: { date: "YYYY-MM-DD" } -> salin dari date ke date+1
  const body = await req.json().catch(() => ({} as any));
  const from = (body?.date as string) || effectiveWIBDate();
  const to = addDays(from, 1);

  // Attendance kemarin
  const { data: att, error: attErr } = await supabaseAdmin
    .from("attendance")
    .select("project_id, technician_id, project_leader")
    .eq("work_date", from);
  if (attErr)
    return NextResponse.json({ error: attErr.message }, { status: 500 });

  const projectIds = Array.from(new Set((att ?? []).map((r) => r.project_id)));
  if (!projectIds.length) return NextResponse.json({ ok: true, inserted: 0 });

  // Proyek yang masih aktif & tidak pending
  const { data: projs } = await supabaseAdmin
    .from("projects")
    .select("id, closed_at, project_status")
    .in("id", projectIds);

  const canRoll = new Set(
    (projs ?? [])
      .filter((p) => !p.closed_at && p.project_status !== "pending")
      .map((p) => p.id)
  );

  // Skip kalau sudah ada attendance hari ini
  const { data: exists } = await supabaseAdmin
    .from("attendance")
    .select("project_id, technician_id")
    .eq("work_date", to)
    .in("project_id", Array.from(canRoll));

  const existSet = new Set(
    (exists ?? []).map((r) => `${r.project_id}::${r.technician_id}`)
  );

  const rows = (att ?? [])
    .filter((r) => canRoll.has(r.project_id))
    .filter((r) => !existSet.has(`${r.project_id}::${r.technician_id}`))
    .map((r) => ({
      project_id: r.project_id,
      technician_id: r.technician_id,
      work_date: to,
      project_leader: !!r.project_leader, // carry-over leader
    }));

  if (rows.length) {
    const { error: insErr } = await supabaseAdmin
      .from("attendance")
      .insert(rows);
    if (insErr)
      return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: rows.length });
}
