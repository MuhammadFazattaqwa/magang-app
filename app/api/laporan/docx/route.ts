// app/api/laporan/docx/route.ts
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import ImageModule, {
  ImageModuleOptions,
} from "docxtemplater-image-module-free";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/* ===================== Supabase (server) ===================== */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseSrvKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseSrvKey);

/* ===================== Konstanta ===================== */
// 1x1 transparent PNG (fallback)
const BLANK_IMAGE_DATAURL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=";

// Pemetaan label → nama file di /public/report-templates
const TEMPLATE_FILE_MAP: Record<string, string> = {
  "template cctv rtrw": "Template_CCTV_RTRW.docx",
  "template bca": "Template_BCA.docx",
  "template mandiri": "Template_Mandiri.docx",
  "template bni": "Template_BNI.docx",
};

/* ===================== Utils ===================== */
const tplDir = () => path.join(process.cwd(), "public", "report-templates");
const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Ambil file template sebagai STRING BINER (bukan Promise, bukan ArrayBuffer) */
async function readTemplateBinaryString(
  req: NextRequest,
  filename: string
): Promise<string> {
  const full = path.join(
    process.cwd(),
    "public",
    "report-templates",
    path.basename(filename)
  );

  // 1) Baca dari filesystem (dev/prod Node)
  try {
    const bin = await fs.readFile(full, { encoding: "binary" });
    return bin; // <-- string biner
  } catch {
    // 2) Fallback: fetch dari public URL (Next.js dev certain env)
    const url = new URL(
      `/report-templates/${encodeURIComponent(filename)}`,
      req.url
    );
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Gagal fetch template: ${url.toString()}`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab).toString("binary"); // <-- konversi ke string biner
  }
}

/** Prefetch image URL jadi data URL (base64). */
async function fetchToDataUrl(url: string): Promise<string> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Gagal fetch image: ${url}`);
  const ct = r.headers.get("content-type") || "image/jpeg";
  const ab = await r.arrayBuffer();
  const b64 = Buffer.from(new Uint8Array(ab)).toString("base64");
  return `data:${ct};base64,${b64}`;
}

/** Image module: getImage harus SINKRON (free module tidak support async). */
function buildImageModule(): ImageModule {
  return new ImageModule({
    getImage: (tagValue: string) => {
      try {
        if (!tagValue) return Buffer.from([]);
        // Di sini diasumsikan tagValue SUDAH data URL (kita prefetch dulu)
        if (tagValue.startsWith("data:")) {
          const base64 = tagValue.split(",")[1] ?? "";
          return Buffer.from(base64, "base64");
        }
        // Jika masih URL biasa (miss prefetch), fallback: blank
        const base64 = BLANK_IMAGE_DATAURL.split(",")[1] ?? "";
        return Buffer.from(base64, "base64");
      } catch {
        const base64 = BLANK_IMAGE_DATAURL.split(",")[1] ?? "";
        return Buffer.from(base64, "base64");
      }
    },
    getSize: () => [480, 360],
  } as ImageModuleOptions);
}

/* ===================== Template resolver ===================== */
async function resolveTemplateFilenameByLabel(label: string): Promise<string> {
  if (!label) return "Template_CCTV_RTRW.docx";
  const key = sanitize(label);
  if (TEMPLATE_FILE_MAP[key]) return TEMPLATE_FILE_MAP[key];

  const files = await fs.readdir(tplDir());
  const docx = files.filter((f) => f.toLowerCase().endsWith(".docx"));
  const wanted = sanitize(label);
  const wanted2 = sanitize(`template ${label}`);
  for (const f of docx) {
    const base = path.basename(f, ".docx");
    const s = sanitize(base);
    if (s === wanted || s === wanted2) return f;
  }
  return "Template_CCTV_RTRW.docx";
}

async function resolveTemplateFromDB(jobId: string): Promise<string> {
  const { data, error } = await supabase
    .from("projects")
    .select("template_key")
    .eq("job_id", jobId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[docx] gagal query template project:", error);
    return "Template_CCTV_RTRW.docx";
  }
  const label = (data?.template_key as string) ?? "";
  return await resolveTemplateFilenameByLabel(label);
}

async function resolveTemplateFilename(
  jobId: string,
  templateKeyParam?: string
): Promise<string> {
  if (templateKeyParam) {
    const candidate = path.basename(templateKeyParam);
    try {
      await fs.access(path.join(tplDir(), candidate));
      return candidate; // nama file langsung
    } catch {
      return resolveTemplateFilenameByLabel(templateKeyParam); // label
    }
  }
  return resolveTemplateFromDB(jobId);
}

/* ===================== Foto loader ===================== */
async function loadPhotos(req: NextRequest, jobId: string) {
  // coba /api/job-photos/[jobId]
  let res = await fetch(
    new URL(`/api/job-photos/${encodeURIComponent(jobId)}`, req.url),
    {
      cache: "no-store",
    }
  );
  if (!res.ok) {
    // fallback /api/job-photos?jobId=
    const alt = new URL(`/api/job-photos`, req.url);
    alt.searchParams.set("jobId", jobId);
    res = await fetch(alt, { cache: "no-store" });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || "Gagal ambil data foto");
  }

  const data = await res.json();
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data.items)
    ? data.items
    : [];

  type Item = {
    id: string | number;
    photo?: string | null;
    photoThumb?: string | null;
    serialNumber?: string | null;
    meter?: number | null;
  };

  return (items as Item[]).map((it) => ({
    category_id: String(it.id),
    // pakai thumb kalau ada
    url: (it.photoThumb || it.photo || null) as string | null,
    serial_number: it.serialNumber ?? null,
    cable_meter: it.meter ?? null,
  }));
}

/* ===================== Generator ===================== */
async function generateDocx(
  req: NextRequest,
  jobId: string,
  templateKeyParam?: string
) {
  if (!jobId) throw new Error("jobId wajib diisi");

  // Tentukan file template
  const templateFilename = await resolveTemplateFilename(
    jobId,
    templateKeyParam
  );
  const templateBinary = await readTemplateBinaryString(req, templateFilename);

  // Sanity check: PizZip harus terima STRING, bukan Promise
  if (templateBinary && typeof (templateBinary as any).then === "function") {
    throw new Error(
      "Internal: templateBinary masih Promise, seharusnya sudah di-await."
    );
  }

  // Ambil foto + PREFETCH semua URL → data URL (agar getImage sinkron)
  const photoRows = await loadPhotos(req, jobId);

  const data: Record<string, any> = {};
  for (const r of photoRows) {
    const id = String(r.category_id);

    // photo: prefetch ke data URL kalau masih URL biasa
    let photoDataUrl = BLANK_IMAGE_DATAURL;
    if (r.url) {
      if (r.url.startsWith("data:")) {
        photoDataUrl = r.url;
      } else {
        try {
          photoDataUrl = await fetchToDataUrl(r.url);
        } catch {
          photoDataUrl = BLANK_IMAGE_DATAURL;
        }
      }
    }
    data[`photo_${id}`] = photoDataUrl;

    // SN
    if (r.serial_number) data[`sn_${id}`] = r.serial_number;

    // meter
    if (typeof r.cable_meter === "number")
      data[`meter_${id}`] = String(r.cable_meter);
  }

  // Buat zip dari STRING BINER
  const zip = new PizZip(templateBinary);

  // Pasang image module (sinkron)
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    modules: [buildImageModule()],
  });

  // v4: TANPA setData, langsung render(data)
  try {
    doc.render(data);
  } catch (e: any) {
    // Perbaiki pesan error agar gampang di-debug
    const errs = e?.properties?.errors as Array<any> | undefined;
    if (errs?.length) {
      console.error("[docx] render errors:");
      for (const er of errs) {
        console.error(`- ${er.properties?.id}: ${er.properties?.explanation}`);
      }
    } else {
      console.error("[docx] render error:", e);
    }
    throw e;
  }

  const out = doc.getZip().generate({ type: "arraybuffer" });
  return new NextResponse(out, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="laporan-${jobId}.docx"`,
    },
  });
}

/* ===================== Handlers ===================== */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const jobId = String(body?.jobId || "");
    const templateKey = body?.templateKey
      ? String(body.templateKey)
      : undefined; // opsional
    return await generateDocx(req, jobId, templateKey);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Gagal generate dokumen" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "");
    // override opsional via query ?template_key=NamaAtauFile.docx
    const templateKey =
      req.nextUrl.searchParams.get("template_key") || undefined;
    return await generateDocx(req, jobId, templateKey);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Gagal generate dokumen" },
      { status: 500 }
    );
  }
}
