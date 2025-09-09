// app/api/technicians/report/[jobId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// ---- Row types sesuai kolom yang kamu SELECT ----
interface ProjectRow {
  id: string;
  job_id: string;
  name: string | null;
  lokasi: string | null;
  closed_at: string | null;
  tanggal_mulai: string | null;
  sigma_teknisi: number | null;
  sales_name: string | null;
  presales_name: string | null;
}

interface PhotoCategoryRow {
  category_id: string;
  name: string;
  requires_serial: boolean;
  position: number;
}

interface JobPhotoEntryRow {
  category_id: string;
  photo_url: string | null;
  thumb_url: string | null;
  serial_number: string | null;
}

type Params = { params: { jobId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const jobId = decodeURIComponent(params.jobId);
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    // supabaseServer adalah instance, BUKAN function → jangan pakai ()
    const supabase = supabaseServer;

    // 1) Project header
    const { data: projData, error: pErr } = await supabase
      .from("projects")
      .select(
        "id, job_id, name, lokasi, closed_at, tanggal_mulai, sigma_teknisi, sales_name, presales_name"
      )
      .eq("job_id", jobId)
      .maybeSingle();

    if (pErr) throw pErr;

    const proj = (projData ?? null) as ProjectRow | null;

    // 2) Categories
    const { data: catsData, error: cErr } = await supabase
      .from("photo_categories")
      .select("category_id, name, requires_serial, position")
      .order("position", { ascending: true });

    if (cErr) throw cErr;

    const cats = (catsData ?? []) as PhotoCategoryRow[];

    // 3) Photo entries per job
    const { data: photosData, error: eErr } = await supabase
      .from("job_photo_entries")
      .select("category_id, photo_url, thumb_url, serial_number")
      .eq("job_id", jobId);

    if (eErr) throw eErr;

    const photos = (photosData ?? []) as JobPhotoEntryRow[];

    // 4) Gabungkan
    const pmap = new Map<string, JobPhotoEntryRow>(
      photos.map((p: JobPhotoEntryRow) => [p.category_id, p])
    );

    const items = cats.map((c: PhotoCategoryRow) => {
      const e = pmap.get(c.category_id);
      return {
        id: String(c.category_id),
        name: c.name,
        requiresSerial: c.requires_serial,
        photo: e?.photo_url ?? null,
        thumb: e?.thumb_url ?? null,
        serialNumber: e?.serial_number ?? null,
      };
    });

    const completedDate: string | null =
      proj?.closed_at ?? proj?.tanggal_mulai ?? null;

    return NextResponse.json(
      {
        header: {
          jobId,
          jobName: proj?.name ?? jobId,
          location: proj?.lokasi ?? "",
          completedDate,
          sigmaTeknisi: proj?.sigma_teknisi ?? null,
          salesName: proj?.sales_name ?? null,
          presalesName: proj?.presales_name ?? null,
        },
        items,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
