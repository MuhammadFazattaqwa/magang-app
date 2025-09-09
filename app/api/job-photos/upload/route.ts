// app/api/job-photos/upload/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServers";

export const runtime = "nodejs"; // pastikan Buffer tersedia

const BUCKET = "job-photos";

function dataUrlToBuffer(dataUrl: string): { buf: Buffer; mime: string; ext: string } {
  const m = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!m) throw new Error("Invalid dataUrl");
  const mime = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  const ext = extFromMime(mime);
  return { buf, mime, ext };
}

function extFromMime(mime?: string | null) {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("bmp")) return "bmp";
  // default jpeg
  return "jpg";
}

async function ensureBucket(supabase: ReturnType<typeof supabaseServer>) {
  // best-effort: kalau service role tersedia
  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) return; // no permission? abaikan
    if (data?.some((b) => b.name === BUCKET)) return;
    await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: "20MB",
    });
  } catch {
    // abaikan kalau tidak punya izin (bucket mungkin sudah ada)
  }
}

async function uploadToSupabase(
  supabase: ReturnType<typeof supabaseServer>,
  jobId: string,
  categoryId: string,
  fileBuf: Buffer,
  mime: string,
  ts: number,
  kind: "full" | "thumb",
  fileExt?: string
) {
  const ext = fileExt || extFromMime(mime);
  const base = `${encodeURIComponent(jobId)}/${String(categoryId)}/${ts}`;
  const path = kind === "thumb" ? `${base}-thumb.${ext}` : `${base}.${ext}`;

  const up = await supabase.storage.from(BUCKET).upload(path, fileBuf, {
    contentType: mime || "image/jpeg",
    upsert: true,
  });
  if (up.error) throw up.error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseServer();
    await ensureBucket(supabase);

    const contentType = req.headers.get("content-type") || "";

    let jobId = "";
    let categoryId = "";
    let photoUrl = "";
    let thumbUrl = "";

    const ts = Date.now();

    if (contentType.includes("multipart/form-data")) {
      // === MODE BARU: FormData (photo & thumb sebagai File) ===
      const form = await req.formData();

      jobId = String(form.get("jobId") || "");
      categoryId = String(form.get("categoryId") || "");
      const photo = form.get("photo") as File | null;
      const thumb = form.get("thumb") as File | null;

      if (!jobId || !categoryId || !photo || !thumb) {
        return NextResponse.json(
          { error: "jobId, categoryId, photo, thumb required" },
          { status: 400 }
        );
      }

      // File → Buffer
      const photoBuf = Buffer.from(await photo.arrayBuffer());
      const thumbBuf = Buffer.from(await thumb.arrayBuffer());

      // mime & ext
      const photoMime = photo.type || "image/jpeg";
      const thumbMime = thumb.type || "image/jpeg";
      const photoExt = extFromMime(photoMime);
      const thumbExt = extFromMime(thumbMime);

      // Upload ke Supabase
      photoUrl = await uploadToSupabase(
        supabase,
        jobId,
        categoryId,
        photoBuf,
        photoMime,
        ts,
        "full",
        photoExt
      );
      thumbUrl = await uploadToSupabase(
        supabase,
        jobId,
        categoryId,
        thumbBuf,
        thumbMime,
        ts,
        "thumb",
        thumbExt
      );
    } else {
      // === MODE LAMA (backward-compat): JSON dataUrl ===
      const { jobId: j, categoryId: c, dataUrl, thumbDataUrl } = await req.json();
      jobId = String(j || "");
      categoryId = String(c || "");

      if (!jobId || !categoryId || !dataUrl || !thumbDataUrl) {
        return NextResponse.json(
          { error: "jobId, categoryId, dataUrl, thumbDataUrl required" },
          { status: 400 }
        );
      }

      const full = dataUrlToBuffer(dataUrl);
      const th = dataUrlToBuffer(thumbDataUrl);

      photoUrl = await uploadToSupabase(
        supabase,
        jobId,
        categoryId,
        full.buf,
        full.mime,
        ts,
        "full",
        full.ext
      );
      thumbUrl = await uploadToSupabase(
        supabase,
        jobId,
        categoryId,
        th.buf,
        th.mime,
        ts,
        "thumb",
        th.ext
      );
    }

    // Upsert metadata ke table (1 row per job+category)
    const upsert = await supabase
      .from("job_photos")
      .upsert(
        {
          job_id: jobId,
          category_id: String(categoryId),
          url: photoUrl,
          thumb_url: thumbUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id,category_id" }
      )
      .select("job_id")
      .maybeSingle();

    if (upsert.error) throw upsert.error;

    // Sukses → cocok dengan safeUpload
    return NextResponse.json({ status: "uploaded", photoUrl, thumbUrl });
  } catch (e: any) {
    const message = e?.message || "Upload failed";
    return NextResponse.json({ status: "error", message }, { status: 500 });
  }
}
