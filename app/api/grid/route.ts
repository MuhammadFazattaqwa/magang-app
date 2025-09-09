import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { effectiveWIBDate } from "@/lib/wib";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || effectiveWIBDate();
  const today = effectiveWIBDate();

  const { data: projects, error: pErr } = await supabaseAdmin
    .from("projects")
    .select(
      `
      id, job_id, name, status, project_status, pending_reason,
      sigma_hari, sigma_teknisi, sigma_man_days,
      jam_datang, jam_pulang,
      tanggal_mulai, tanggal_deadline, created_at
    `
    )
    // Filter project berdasarkan rentang waktu: hanya tampilkan project yang aktif pada tanggal yang dipilih
    .lte("tanggal_mulai", date) // Project sudah dimulai
    .gte("tanggal_deadline", date) // Project belum berakhir
    .order("created_at", { ascending: false });

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const ids = (projects ?? []).map((p) => p.id);

  // Ambil assignment pada tanggal 'date'
  const dayAssign = await (async () => {
    if (!ids.length) return [];
    const { data, error } = await supabaseAdmin
      .from("attendance")
      .select("project_id, technician_id, is_leader")
      .eq("work_date", date)
      .in("project_id", ids);
    if (error) throw error;
    return data ?? [];
  })().catch((e) => {
    return [] as any[];
  });

  const techIds = Array.from(
    new Set(dayAssign.map((a: any) => a.technician_id))
  );
  const techMap = new Map<
    string,
    { id: string; code: string; name: string; initials: string }
  >();
  if (techIds.length) {
    const { data: techs, error: tErr } = await supabaseAdmin
      .from("technicians")
      .select("id, code, name, initials")
      .in("id", techIds);
    if (tErr)
      return NextResponse.json({ error: tErr.message }, { status: 500 });
    for (const t of techs ?? []) {
      techMap.set(t.id, {
        id: t.id,
        code: t.code,
        name: t.name,
        initials: (t.initials ?? t.name?.[0] ?? "?").toUpperCase(),
      });
    }
  }

  // Akumulasi man-days s/d 'today'
  const actualMap = new Map<string, number>();
  if (ids.length) {
    const { data: assigns, error: aErr } = await supabaseAdmin
      .from("attendance")
      .select("project_id")
      .lte("work_date", today)
      .in("project_id", ids);
    if (aErr)
      return NextResponse.json({ error: aErr.message }, { status: 500 });
    for (const r of assigns ?? []) {
      actualMap.set(r.project_id, (actualMap.get(r.project_id) ?? 0) + 1);
    }
  }

  const daysElapsed = (start?: string | null) => {
    if (!start) return 0;
    const s = new Date(`${start}T00:00:00Z`);
    const t = new Date(`${today}T00:00:00Z`);
    const diff = Math.floor((t.getTime() - s.getTime()) / 86400000) + 1;
    return diff > 0 ? diff : 0;
  };

  const techniciansByProject = new Map<string, any[]>();
  for (const row of dayAssign) {
    const t = techMap.get(row.technician_id);
    if (!t) continue;
    const arr = techniciansByProject.get(row.project_id) ?? [];
    arr.push({
      id: t.id,
      code: t.code,
      name: t.name,
      initials: t.initials,
      isProjectLeader: !!row.is_leader,
    });
    techniciansByProject.set(row.project_id, arr);
  }

  const shaped =
    (projects ?? []).map((p) => ({
      id: p.id,
      projectId: p.id,
      code: p.job_id,
      job_id: p.job_id,
      name: p.name,
      progressStatus: p.status ?? "ongoing",
      status: p.status ?? "ongoing",
      projectStatus: p.project_status ?? "unassigned",
      project_status: p.project_status ?? "unassigned",
      pendingReason: p.pending_reason ?? null,
      sigma_hari: p.sigma_hari ?? 0,
      sigma_hari_target: p.sigma_hari ?? 0,
      sigma_teknisi: p.sigma_teknisi ?? 0,
      sigma_man_days: p.sigma_man_days ?? 0,
      jam_datang: p.jam_datang,
      jam_pulang: p.jam_pulang,
      daysElapsed: daysElapsed(p.tanggal_mulai),
      days_elapsed: daysElapsed(p.tanggal_mulai),
      technicians: techniciansByProject.get(p.id) ?? [],
      actualManDays: actualMap.get(p.id) ?? 0,
      actual_man_days: actualMap.get(p.id) ?? 0,
    })) ?? [];

  return NextResponse.json({ date, data: shaped });
}
