/* eslint-disable @typescript-eslint/ban-ts-comment */
import Tesseract from "tesseract.js";

/* ===== Types ===== */
export type OCRPhase = "idle" | "barcode" | "ocr" | "done" | "error";
export interface OcrInfo { status: OCRPhase; progress: number; error?: string }
export type OcrProgress = (info: OcrInfo) => void;

/* ================= Normalisasi & Seleksi ================= */

export function normalizeSN(val: string) {
  let out = (val || "").toUpperCase();

  // rapikan spasi
  out = out.replace(/\s+/g, " ").trim();

  // koreksi karakter mirip ketika diapit digit
  out = out
    .replace(/Q(?=\d)/g, "0")
    .replace(/(?<=\d)O(?=\d)/g, "0")
    .replace(/(?<=\d)[IL](?=\d)/g, "1")
    .replace(/(?<=\d)B(?=\d)/g, "8")
    .replace(/(?<=\d)S(?=\d)/g, "5");

  // simpan hanya A-Z 0-9 dan - /
  out = out.replace(/[^\w\-\/]/g, "");

  // buang suffix revisi di AKHIR, mis. /r3 /R2 /V1 /A12
  out = out.replace(/\/[A-Z]?\d{1,3}$/i, "");

  return out;
}

/** Koreksi akhir kandidat:
 * - 2 ↔ Z berdasarkan konteks huruf/angka
 * - pangkas ekor huruf saja (noise) bila sudah ada huruf+angka
 * - ambil run 8-20 alnum (huruf+angka) atau 9-20 digit (seri numeric)
 */
function postFixCandidate(raw: string): string | null {
  let s = normalizeSN(raw);

  // Jika diapit HURUF, '2' kemungkinan 'Z'
  s = s.replace(/(?<=[A-Z])2(?=[A-Z])/g, "Z");
  // Jika diapit DIGIT, 'Z' kemungkinan '2'
  s = s.replace(/(?<=\d)Z(?=\d)/g, "2");

  // Bila sudah huruf+angka, buang ekor huruf murni (noise sebelah label lain)
  if (/[A-Z]/.test(s) && /\d/.test(s)) {
    s = s.replace(/[A-Z]{2,}$/g, "");
  }

  // Pilih run alnum 8–20 yang memuat huruf & angka
  const alnum = s.match(/(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{8,20}/);
  if (alnum) return alnum[0];

  // Atau bila numeric-only panjang 9–20
  const digits = s.match(/\d{9,20}/);
  if (digits) return digits[0];

  return null;
}

/** Pilih kandidat terbaik dari string longgar */
function selectBestSN(loose: string): string | null {
  const cleaned = normalizeSN(loose);
  // coba urutan: alnum 8–20 (huruf+angka) → digit 12+ → digit 9–11
  const a = cleaned.match(/(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{8,20}/);
  if (a) return a[0];
  const d12 = cleaned.match(/\d{12,20}/);
  if (d12) return d12[0];
  const d9 = cleaned.match(/\d{9,11}/);
  if (d9) return d9[0];
  return null;
}

/* ================ Ekstraksi dari hasil OCR ================ */

function extractSN(
  ocrText: string,
  words?: Array<{ text: string }>,
  lines?: Array<{ text: string }>
) {
  const labelRe = /\b(?:S\/?N|SERIAL(?:\s*NO\.?|(?:\s*NUMBER)?))\b/i;
  const T = (ocrText || "").toUpperCase();

  // 1) Per-baris setelah label (paling kuat)
  for (const L of (lines || [])) {
    if (!L?.text) continue;
    if (labelRe.test(L.text)) {
      // ambil run kandidat pertama setelah label pada baris tsb
      const after = L.text.replace(/^.*?(?:S\/?N|SERIAL(?:\s*NO\.?|(?:\s*NUMBER)?))\b\s*[:#-]?\s*/i, "");
      // potong sampai spasi ganda / label lain
      const m = after.match(/[A-Z0-9\-\/ ]{5,}/i)?.[0] ?? after;
      const cand = postFixCandidate(m) ?? selectBestSN(m);
      if (cand) return cand;
    }
  }

  // 2) Token setelah label (maks 4 token sampai berhenti)
  if (words?.length) {
    for (let i = 0; i < words.length; i++) {
      if (labelRe.test(words[i]?.text || "")) {
        let buf = "";
        for (let j = i + 1; j < Math.min(words.length, i + 5); j++) {
          const w = (words[j]?.text || "").toUpperCase();
          if (!/^[A-Z0-9\-\/]+$/.test(w)) break;
          buf += (buf ? "" : "") + w;
          const fixed = postFixCandidate(buf);
          if (fixed && fixed.length >= 8) return fixed;
        }
        const alt = postFixCandidate(buf) ?? selectBestSN(buf);
        if (alt) return alt;
      }
    }
  }

  // 3) Global: label lalu run alnum
  const mg = T.match(new RegExp(labelRe.source + String.raw`\s*[:#-]?\s*([A-Z0-9\s\-\/]{5,})`, "i"));
  if (mg?.[1]) {
    const cand = postFixCandidate(mg[1]) ?? selectBestSN(mg[1]);
    if (cand) return cand;
  }

  // 4) Bila ada baris berlabel, cari run alnum panjang di baris tsb
  const line = (T.split(/\r?\n/).find((l) => labelRe.test(l)) || "").replace(labelRe, "");
  const loose = line.match(/[A-Z0-9\-\/]{6,}/i)?.[0];
  if (loose) {
    const cand = postFixCandidate(loose) ?? selectBestSN(loose);
    if (cand) return cand;
  }

  // 5) Fallback: run digit panjang
  const digits = T.match(/\b\d{9,20}\b/);
  if (digits?.[0]) {
    const cand = postFixCandidate(digits[0]) ?? digits[0];
    if (cand) return cand;
  }

  return "";
}

/* ================== Helpers gambar ================== */

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.readAsDataURL(blob);
  });
}

async function scaleUpDataUrl(dataUrl: string, factor = 2.5): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * factor);
      c.height = Math.round(img.naturalHeight * factor);
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function rotateDataUrl(dataUrl: string, deg: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const rad = (deg * Math.PI) / 180;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d")!;
      if (deg % 180 === 0) { c.width = w; c.height = h; } else { c.width = h; c.height = w; }
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -w / 2, -h / 2);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ================ Barcode via ZXing (opsional) ================ */

async function tryDecodeBarcodeFromDataUrl(dataUrl: string): Promise<string | null> {
  try {
    if (typeof window === "undefined") return null;
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const imgEl = new Image();
    imgEl.src = dataUrl;
    await new Promise<void>((res, rej) => { imgEl.onload = () => res(); imgEl.onerror = () => rej(new Error("img load")); });
    // @ts-ignore
    const result = await new BrowserMultiFormatReader().decodeFromImageElement(imgEl as HTMLImageElement);
    const txt = (result as any)?.getText?.() ?? "";
    const sn = postFixCandidate(txt) ?? selectBestSN(txt);
    return sn;
  } catch { return null; }
}

/* ===================== PUBLIC API ===================== */
/** mode:
 *  - 'fast' : 1 rotasi (0°) PSM6 → sangat cepat
 *  - 'deep' : tambah PSM7 & rotasi 90/180/270 untuk kasus sulit
 */
export async function recognizeSerialNumber(
  imageSource: Blob | string,
  opts?: { onProgress?: OcrProgress; enableBarcode?: boolean; mode?: "fast" | "deep" }
): Promise<string | null> {
  const onProgress = opts?.onProgress;
  const enableBarcode = opts?.enableBarcode ?? true;
  const mode = opts?.mode ?? "deep";

  try {
    onProgress?.({ status: "barcode", progress: 0 });
    const dataUrl = typeof imageSource === "string" ? imageSource : await blobToDataUrl(imageSource);

    // 1) Barcode (super cepat)
    if (enableBarcode) {
      const bc = await tryDecodeBarcodeFromDataUrl(dataUrl);
      if (bc) { onProgress?.({ status: "done", progress: 100 }); return bc; }
    }

    // 2) OCR
    const scaled = await scaleUpDataUrl(dataUrl, 2.5);
    const anglesFast = [0] as const;
    const anglesDeep = [90, 180, 270] as const;

    onProgress?.({ status: "ocr", progress: 10 });

    const tryPSM = async (psm: 6 | 7, angs: readonly number[]) => {
      for (const ang of angs) {
        const du = ang === 0 ? scaled : await rotateDataUrl(scaled, ang);
        const result: any = await Tesseract.recognize(du, "eng", {
          // @ts-ignore
          logger: (m: any) => m?.status === "recognizing text" && m?.progress != null &&
            onProgress?.({ status: "ocr", progress: Math.min(99, Math.round(10 + m.progress * 80)) }),
          // @ts-ignore
          tessedit_pageseg_mode: String(psm),
          preserve_interword_spaces: "1",
        });

        const text = (result?.data?.text ?? "").trim();
        // @ts-ignore
        const words = (result?.data?.words ?? []) as Array<{ text: string }>;
        // @ts-ignore
        const lines = (result?.data?.lines ?? []) as Array<{ text: string }>;

        const sn =
          postFixCandidate(extractSN(text, words, lines)) ??
          extractSN(text, words, lines);
        if (sn && sn.length >= 8) return sn;
      }
      return null;
    };

    // FAST path
    const fast = await tryPSM(6, anglesFast);
    if (fast) { onProgress?.({ status: "done", progress: 100 }); return fast; }
    if (mode === "fast") { onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." }); return null; }

    // DEEP path
    const deep1 = await tryPSM(7, anglesFast);
    if (deep1) { onProgress?.({ status: "done", progress: 100 }); return deep1; }
    const deep2 = await tryPSM(6, anglesDeep);
    if (deep2) { onProgress?.({ status: "done", progress: 100 }); return deep2; }

    onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." });
    return null;
  } catch (e: any) {
    onProgress?.({ status: "error", progress: 0, error: e?.message || "Gagal memproses OCR." });
    return null;
  }
}
