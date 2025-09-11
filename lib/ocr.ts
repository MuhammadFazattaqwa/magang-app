/* eslint-disable @typescript-eslint/ban-ts-comment */
import Tesseract from "tesseract.js";

/* ===== Types ===== */
export type OCRPhase = "idle" | "barcode" | "ocr" | "done" | "error";
export interface OcrInfo { status: OCRPhase; progress: number; error?: string }
export type OcrProgress = (info: OcrInfo) => void;

/* ===== Normalisasi SN =====
   - Perbaikan: buang suffix revisi seperti /r3, /R2, /V1, /A12 di *bagian akhir* string
   - Koreksi karakter mirip (O/0, I/L/1, B/8, S/5) dalam konteks angka
*/
export function normalizeSN(val: string) {
  let out = (val || "").toUpperCase();

  // rapikan spasi
  out = out.replace(/\s+/g, " ").trim();

  // koreksi karakter mirip (hanya ketika diapit digit)
  out = out
    .replace(/Q(?=\d)/g, "0")
    .replace(/(?<=\d)O(?=\d)/g, "0")
    .replace(/(?<=\d)[IL](?=\d)/g, "1")
    .replace(/(?<=\d)B(?=\d)/g, "8")
    .replace(/(?<=\d)S(?=\d)/g, "5");

  // keep A-Z 0-9, -, /
  out = out.replace(/[^\w\-\/]/g, "");

  // HAPUS suffix revisi di AKHIR: /r3, /R2, /v1, /A12 (maks 1 huruf opsional + 1-3 digit)
  out = out.replace(/\/[A-Z]?\d{1,3}$/i, "");

  return out;
}

/* ===== Seleksi kandidat terbaik =====
   - Terima alnum 8–20 yang mengandung huruf & angka
   - Kalau numeric-only, minta >= 12 supaya tidak terpotong (contoh stiker panjang)
*/
function selectBestSN(raw: string): string | null {
  const base = normalizeSN(raw);
  const alnum = base.replace(/[^A-Z0-9]/g, "");

  // numeric panjang (mis. 0006028230300108)
  if (/^\d{12,}$/.test(alnum)) return alnum;

  // pola 8+ alfanumerik harus ada huruf & angka
  const m8 = alnum.match(/(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{8,}/);
  if (m8) return m8[0];

  // fallback terkontrol
  if (alnum.length >= 9 && alnum.length <= 20 && /[A-Z]/.test(alnum) && /\d/.test(alnum)) return alnum;

  // terakhir: minimal 8
  return alnum.length >= 8 ? alnum.slice(0, 8) : null;
}

/* ===== Ekstraksi dari teks OCR (mengutamakan yang berlabel SN/Serial) ===== */
function extractSN(
  ocrText: string,
  words?: Array<{ text: string }>,
  lines?: Array<{ text: string }>
) {
  const labelRe = /\b(?:S\/?N|SERIAL(?:\s*NO\.?|(?:\s*NUMBER)?))\b/i;

  // 1) Per-baris (paling kuat)
  for (const L of (lines || [])) {
    if (labelRe.test(L.text)) {
      const after = (L.text.split(labelRe)[1] ?? "");
      const sn = selectBestSN(after);
      if (sn) return sn;
    }
  }

  // 2) Token setelah label
  if (words?.length) {
    for (let i = 0; i < words.length; i++) {
      if (labelRe.test(words[i].text)) {
        const sn = selectBestSN([(words[i + 1]?.text ?? ""), (words[i + 2]?.text ?? "")].join(" "));
        if (sn) return sn;
      }
    }
  }

  // 3) Global pattern: label lalu deretan alnum
  const T = (ocrText || "").toUpperCase();
  const mg = T.match(new RegExp(labelRe.source + String.raw`\s*[:#-]?\s*([A-Z0-9\s\-\/]{5,})`, "i"));
  if (mg?.[1]) {
    const sn = selectBestSN(mg[1]);
    if (sn) return sn;
  }

  // 4) Baris yang mengandung label → cari run alnum panjang
  const line = (T.split(/\r?\n/).find((l) => labelRe.test(l)) || "").replace(labelRe, "");
  const loose = line.match(/[A-Z0-9\-\/]{6,}/i);
  if (loose?.[0]) {
    const sn = selectBestSN(loose[0]);
    if (sn) return sn;
  }

  // 5) Fallback: deretan digit panjang (12+)
  const digits = T.match(/\b\d{12,}\b/);
  if (digits?.[0]) {
    const sn = selectBestSN(digits[0]);
    if (sn) return sn;
  }

  return "";
}

/* ===== Helpers gambar ===== */
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

/* ===== Barcode via ZXing (fallback bila ada) ===== */
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
    const sn = selectBestSN(txt);
    return sn;
  } catch { return null; }
}

/* ===== PUBLIC API =====
   - mode: 'fast' hanya 1 rotasi (0°) PSM6 → sangat cepat
   - mode: 'deep' tambah PSM7 & rotasi 90/180/270 untuk kasus sulit
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
        // @ts-ignore
        const result = await Tesseract.recognize(du, "eng", {
          // @ts-ignore
          logger: (m) => m?.status === "recognizing text" && m?.progress != null &&
            onProgress?.({ status: "ocr", progress: Math.min(99, Math.round(10 + m.progress * 80)) }),
          // @ts-ignore
          tessedit_pageseg_mode: String(psm),
          preserve_interword_spaces: "1",
        });

        const text = (result.data?.text ?? "").trim();
        // @ts-ignore
        const words = (result.data?.words ?? []) as Array<{ text: string }>;
        // @ts-ignore
        const lines = (result.data?.lines ?? []) as Array<{ text: string }>;

        const sn = extractSN(text, words, lines);
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
