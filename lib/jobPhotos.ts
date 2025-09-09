import { supabaseServer } from "@/lib/supabaseServer";

export type JobPhotoEntry = {
  id: string;
  job_id: string;
  category_id: string;
  url: string;
  width?: number | null;
  height?: number | null;
  meta?: any;
  created_at: string;
};

export async function uploadJobPhoto(
  jobId: string,
  categoryId: string,
  file: File | Blob,
  filename?: string
): Promise<JobPhotoEntry> {
  const bucket = "job-photos";
  const ext =
    (typeof File !== "undefined" &&
      file instanceof File &&
      file.name.split(".").pop()) ||
    filename?.split(".").pop() ||
    "jpg";

  const objectPath = `${jobId}/${categoryId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${ext}`;

  const { error: upErr } = await supabaseServer.storage
    .from(bucket)
    .upload(objectPath, file, {
      contentType:
        (typeof File !== "undefined" && file instanceof File && file.type) ||
        "image/jpeg",
      upsert: false,
      cacheControl: "31536000",
    });

  if (upErr) throw upErr;

  const {
    data: { publicUrl },
  } = supabaseServer.storage.from(bucket).getPublicUrl(objectPath);

  const { data: inserted, error: insErr } = await supabaseServer
    .from("job_photo_entries")
    .insert({
      job_id: jobId,
      category_id: categoryId,
      url: publicUrl,
    })
    .select()
    .single();

  if (insErr) throw insErr;
  return inserted as JobPhotoEntry;
}

/**
 * Update meta pada foto TERBARU untuk kombinasi (jobId, categoryId).
 * - Akan merge field meta lama dengan yang baru
 * - Opsional: jika `serialNumber` ada, upsert juga ke tabel `job_serial_numbers`
 */
export async function updateJobPhotoMeta(args: {
  jobId: string;
  categoryId: string;
  serialNumber?: string;
  meter?: number;
  ocrStatus?: string; // "barcode" | "ocr" | "done" | "error" | "idle"
  userId?: string | null;
}) {
  const { jobId, categoryId, serialNumber, meter, ocrStatus, userId } = args;

  // 1) Ambil foto terbaru (kalau belum ada foto, kita tidak bikin row baru)
  const { data: latest, error: qErr } = await supabaseServer
    .from("job_photo_entries")
    .select("id, meta")
    .eq("job_id", jobId)
    .eq("category_id", categoryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (qErr) throw qErr;
  if (!latest) {
    throw new Error("Belum ada foto untuk jobId/categoryId ini");
  }

  // 2) Merge meta
  const nowIso = new Date().toISOString();
  const patch: Record<string, any> = {
    ...(latest.meta ?? {}),
    updatedAt: nowIso,
  };
  if (typeof userId === "string") patch.updatedBy = userId;
  if (typeof serialNumber === "string") patch.serialNumber = serialNumber;
  if (typeof meter === "number") patch.meter = meter;
  if (typeof ocrStatus === "string") patch.ocrStatus = ocrStatus;

  const { data: updated, error: upErr } = await supabaseServer
    .from("job_photo_entries")
    .update({ meta: patch })
    .eq("id", latest.id)
    .select()
    .single();

  if (upErr) throw upErr;

  // 3) (Opsional) simpan SN ke tabel khusus untuk reporting, jika tersedia
  if (typeof serialNumber === "string" && serialNumber.trim()) {
    // label: pakai categoryId sebagai key default; sesuaikan kalau kamu punya mapping label sendiri
    await supabaseServer.from("job_serial_numbers").upsert(
      {
        job_id: jobId,
        label: categoryId,
        value: serialNumber.trim(),
        updated_at: nowIso,
      },
      { onConflict: "job_id,label" }
    );
  }

  return updated;
}
