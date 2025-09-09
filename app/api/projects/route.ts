import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { effectiveWIBDate } from "@/lib/wib";

type NewProjectPayload = {
  namaProject: string;
  lokasi?: string | null;
  namaSales?: string | null;
  namaPresales?: string | null;
  tanggalSpkUser?: string | null;
  tanggalTerimaPo?: string | null;
  tanggalMulaiProject: string;
  tanggalDeadlineProject: string;
  sigmaManDays: number;
  sigmaHari: number;
  sigmaTeknisi: number;
};

/* ---------- Utils ---------- */

// selisih hari inklusif, aman UTC dari "YYYY-MM-DD"
const diffDaysInclusiveUTC = (start: string, end: string) => {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const sUTC = Date.UTC(ys, (ms ?? 1) - 1, ds ?? 1);
  const eUTC = Date.UTC(ye, (me ?? 1) - 1, de ?? 1);
  const d = Math.floor((eUTC - sUTC) / 86400000) + 1;
  return d > 0 ? d : 0;
};

// pilih tanggal yang lebih awal (string YYYY-MM-DD)
const earlierOf = (a?: string | null, b?: string | null) => {
  if (a && b) return a < b ? a : b;
  return a ?? b ?? null;
};

// hitung days_elapsed + freeze saat pending
// ganti normalCutoff dari earlierOf(deadline, today) -> today
const computeDaysElapsed = (params: {
  start?: string | null;
  today: string;
  deadline?: string | null;
  isPending: boolean;
  lastAttendanceDate?: string | null;
  pendingSince?: string | null;
}) => {
  const {
    start,
    today,
    deadline,
    isPending,
    lastAttendanceDate,
    pendingSince,
  } = params;
  if (!start) return 0;

  const normalCutoff = today; // ⬅️ progress jalan terus kalau tidak pending
  const basePendingCutoff = pendingSince || lastAttendanceDate || today;
  const pendingCutoff =
    earlierOf(basePendingCutoff, deadline) ?? basePendingCutoff;

  const cutoff = isPending ? pendingCutoff : normalCutoff;
  return diffDaysInclusiveUTC(start, cutoff);
};

/* ---------- GET: list projects (+progress freeze saat pending) ---------- */

export async function GET(req?: NextRequest) {
  // tanggal referensi = query ?date=YYYY-MM-DD, default WIB Today
  const todayWIB = effectiveWIBDate();
  const url = req ? new URL(req.url) : null;
  const queryDate = url?.searchParams.get("date") || todayWIB;

  const { data: projects, error: pErr } = await supabaseAdmin
    .from("projects")
    .select(
      `
      id, job_id, name, lokasi,
      sales_name, presales_name,
      status,
      project_status,
      pending_reason, pending_since,
      sigma_hari, sigma_teknisi, sigma_man_days,
      jam_datang, jam_pulang,
      tanggal_mulai, tanggal_deadline,
      closed_at,
      created_at
    `
    )
    // aktif pada tanggal dipilih: start <= d && (deadline IS NULL || deadline >= d) && belum closed
    .lte("tanggal_mulai", queryDate)
    .neq("status", "completed")
    .order("created_at", { ascending: false });

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const ids = (projects ?? []).map((p) => p.id);

  // hitung actual man days & lastAttendanceDate sampai queryDate
  const actual = new Map<string, number>();
  const lastDate = new Map<string, string>();
  if (ids.length) {
    const { data: assigns, error: aErr } = await supabaseAdmin
      .from("attendance")
      .select("project_id, work_date")
      .lte("work_date", queryDate)
      .in("project_id", ids);

    if (aErr)
      return NextResponse.json({ error: aErr.message }, { status: 500 });

    for (const r of assigns ?? []) {
      actual.set(r.project_id, (actual.get(r.project_id) ?? 0) + 1);
      const prev = lastDate.get(r.project_id);
      if (!prev || r.work_date > prev) lastDate.set(r.project_id, r.work_date);
    }
  }

  const shaped = (projects ?? []).map((p) => {
    const isPending = p.project_status === "pending" || !!p.pending_reason;

    const days_elapsed = computeDaysElapsed({
      start: p.tanggal_mulai,
      today: queryDate,
      deadline: p.tanggal_deadline,
      isPending,
      lastAttendanceDate: lastDate.get(p.id) ?? null,
      pendingSince: p.pending_since ?? null,
    });

    let progressStatus: "ongoing" | "completed" | "overdue" = "ongoing";
    if (p.closed_at) {
      progressStatus = "completed";
    } else if (
      (p.sigma_hari && days_elapsed > p.sigma_hari) ||
      (p.tanggal_deadline && queryDate > p.tanggal_deadline)
    ) {
      progressStatus = "overdue";
    }

    return {
      id: p.id,
      job_id: p.job_id,
      name: p.name,
      lokasi: p.lokasi,
      sales_name: p.sales_name,
      presales_name: p.presales_name,

      status: progressStatus,
      project_status: p.project_status as "unassigned" | "ongoing" | "pending",
      pending_reason: p.pending_reason ?? null,

      sigma_hari: p.sigma_hari ?? 0,
      sigma_teknisi: p.sigma_teknisi ?? 0,
      sigma_man_days: p.sigma_man_days ?? 0,

      jam_datang: p.jam_datang,
      jam_pulang: p.jam_pulang,
      days_elapsed,

      created_at: p.created_at,
      assignment_count: 0,
      leader_count: 0,
      actual_man_days: actual.get(p.id) ?? 0,
    };
  });

  return NextResponse.json({ data: shaped });
}

/* ---------- POST: create project ---------- */

// /app/api/projects/route.ts (bagian POST)
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    namaProject: string;
    lokasi?: string | null;
    namaSales?: string | null;
    namaPresales?: string | null;
    tanggalSpkUser?: string | null;
    tanggalTerimaPo?: string | null;
    tanggalMulaiProject: string;
    tanggalDeadlineProject: string;
    sigmaManDays: number;
    sigmaHari: number;
    sigmaTeknisi: number;
    templateKey: string;
  };

  if (
    !body.namaProject ||
    !body.tanggalMulaiProject ||
    !body.tanggalDeadlineProject ||
    !body.templateKey
  ) {
    return NextResponse.json(
      { error: "Data project tidak lengkap" },
      { status: 400 }
    );
  }

  const insert = {
    name: body.namaProject.trim(),
    lokasi: body.lokasi?.trim() || null, // ✅ simpan lokasi di kolom lokasi
    sales_name: body.namaSales ?? null, // ✅ tarik nama sales
    presales_name: body.namaPresales ?? null,
    tgl_spk_user: body.tanggalSpkUser ?? null,
    tgl_terima_po: body.tanggalTerimaPo ?? null,
    tanggal_mulai: body.tanggalMulaiProject,
    tanggal_deadline: body.tanggalDeadlineProject,
    sigma_man_days: body.sigmaManDays ?? 0,
    sigma_hari: body.sigmaHari ?? 0,
    sigma_teknisi: body.sigmaTeknisi ?? 0,
    // status: biarkan default enum 'belum_diassign'
    project_status: "unassigned" as const, // enum baru
    jam_datang: "08:00:00",
    jam_pulang: "17:00:00",
    template_key: body.templateKey,
  };

  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert(insert)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // days_elapsed awal (pakai tanggal mulai vs tanggalMulaiProject)
  const refDate = effectiveWIBDate();
  const daysElapsed = computeDaysElapsed({
    start: data.tanggal_mulai,
    today: refDate,
    deadline: data.tanggal_deadline,
    isPending: false,
  });

  const shaped = {
    id: data.id,
    job_id: data.job_id,
    name: data.name,
    lokasi: data.lokasi,
    sales_name: data.sales_name,
    presales_name: data.presales_name,
    status: "ongoing" as const,
    project_status: data.project_status,
    pending_reason: data.pending_reason,
    sigma_hari: data.sigma_hari,
    sigma_teknisi: data.sigma_teknisi,
    sigma_man_days: data.sigma_man_days,
    jam_datang: data.jam_datang,
    jam_pulang: data.jam_pulang,
    days_elapsed: daysElapsed,
    created_at: data.created_at,
    assignment_count: 0,
    leader_count: 0,
    actual_man_days: 0,
  };

  return NextResponse.json({ data: shaped }, { status: 201 });
}
