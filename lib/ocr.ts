/* eslint-disable @typescript-eslint/ban-ts-comment */
/* lib/ocr.ts — OCR Serial Number cepat, aman untuk PWA (background-friendly) */

import Tesseract from "tesseract.js";

/* ===== Types untuk progress OCR di UI ===== */
export type OCRPhase = "idle" | "barcode" | "ocr" | "done" | "error";
export interface OcrInfo {
  status: OCRPhase;
  progress: number;
  error?: string;
}
export type OcrProgress = (info: OcrInfo) => void;

/* ====== Helper umum ====== */
function isBrowser() {
  return typeof window !== "undefined";
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T | null> {
  let to: any;
  const killer = new Promise<null>((resolve) => {
    to = setTimeout(() => {
      try { onTimeout?.(); } catch {}
      resolve(null);
    }, ms);
  });
  return Promise.race([
    p.then((v) => {
      clearTimeout(to);
      return v as any;
    }),
    killer,
  ]) as Promise<T | null>;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.readAsDataURL(blob);
  });
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
}

async function rotateDataUrl(dataUrl: string, deg: number): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const rad = (deg * Math.PI) / 180;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    if (deg % 180 === 0) {
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
    } else {
      c.width = img.naturalHeight;
      c.height = img.naturalWidth;
    }
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    return c.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

async function scaleUpDataUrl(dataUrl: string, factor = 3): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const c = document.createElement("canvas");
    c.width = Math.max(16, Math.round(img.naturalWidth * factor));
    c.height = Math.max(16, Math.round(img.naturalHeight * factor));
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

/* ====== Normalisasi & ekstraksi SN ====== */
export function normalizeSN(val: string) {
  let out = (val || "").trim().toUpperCase().replace(/\s+/g, "");
  out = out.replace(/Q(?=\d)/g, "0").replace(/(?<=\d)O(?=\d)/g, "0").replace(/O(?=\d)/g, "0");
  out = out.replace(/(?<=\d)[IL](?=\d)/g, "1").replace(/(?<=\d)B(?=\d)/g, "8").replace(/(?<=\d)S(?=\d)/g, "5");
  return out.replace(/[^\w\-\/]/g, "");
}

function selectBestSN(raw: string): string | null {
  const left = raw.split("/")[0]; // buang revisi setelah slash
  const alnum = normalizeSN(left).replace(/[^A-Z0-9]/g, "");

  if (raw.includes("/") && alnum.length >= 9) return alnum;
  if (/^\d{12,}$/.test(alnum)) return alnum;

  const m8 = alnum.match(/(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{8}/);
  if (m8) return m8[0];

  if (alnum.length >= 9 && alnum.length <= 20 && /[A-Z]/.test(alnum) && /\d/.test(alnum)) return alnum;
  return alnum.length >= 8 ? alnum.slice(0, 8) : null;
}

function extractSN(ocrText: string, words?: Array<{ text: string }>, lines?: Array<{ text: string }>) {
  const labelRe = /\b(?:S\/?N|SERIAL(?:\s*NO\.?|(?:\s*NUMBER)?))\b/i;

  // Per-baris
  for (const L of lines || []) {
    if (labelRe.test(L.text)) {
      const sn = selectBestSN(L.text.split(labelRe)[1] ?? "");
      if (sn) return sn;
    }
  }
  // Token setelah label
  if (words?.length) {
    for (let i = 0; i < words.length; i++) {
      if (labelRe.test(words[i].text)) {
        const sn = selectBestSN([(words[i + 1]?.text ?? ""), (words[i + 2]?.text ?? "")].join(" "));
        if (sn) return sn;
      }
    }
  }
  // Global pattern
  const T = (ocrText || "").toUpperCase();
  const mg = T.match(new RegExp(labelRe.source + String.raw`\s*[:#-]?\s*([A-Z0-9\s\-\/]{5,})`, "i"));
  if (mg?.[1]) {
    const sn = selectBestSN(mg[1]);
    if (sn) return sn;
  }
  // Long run
  const line = (T.split(/\r?\n/).find((l) => labelRe.test(l)) || "").replace(labelRe, "");
  const loose = line.match(/[A-Z0-9\-\/]{6,}/i);
  if (loose?.[0]) {
    const sn = selectBestSN(loose[0]);
    if (sn) return sn;
  }
  // Fallback digit panjang
  const digits = T.match(/\b\d{8,}\b/);
  if (digits?.[0]) {
    const sn = selectBestSN(digits[0]);
    if (sn) return sn;
  }
  return "";
}

/* ====== ZXing barcode (lazy import) ====== */
async function tryDecodeBarcodeFromDataUrl(dataUrl: string): Promise<string | null> {
  try {
    if (!isBrowser()) return null;
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const imgEl = new Image();
    imgEl.src = dataUrl;
    await new Promise<void>((res, rej) => {
      imgEl.onload = () => res();
      imgEl.onerror = () => rej(new Error("img load"));
    });
    // @ts-ignore
    const result = await new BrowserMultiFormatReader().decodeFromImageElement(imgEl as HTMLImageElement);
    const txt = (result as any)?.getText?.() ?? "";
    return selectBestSN(txt);
  } catch {
    return null;
  }
}

/* ====== Tesseract v5 worker singleton (lazy) ====== */
let workerPromise: Promise<any> | null = null;
let workerInst: any | null = null;

async function ensureWorker(): Promise<any | null> {
  if (!isBrowser()) return null;
  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        // v5: bahasa sebagai argumen pertama
        const worker = await (Tesseract as any).createWorker("eng", {
          // logger: (m: any) => console.log("[tesseract]", m),
        } as any);

        // Set parameter via setParameters jika tersedia
        try {
          await (worker as any).setParameters?.({
            tessedit_pageseg_mode: "6", // SINGLE_BLOCK
            preserve_interword_spaces: "1",
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:",
          });
        } catch {
          // fallback untuk build yang expose reinitialize
          if ((worker as any).reinitialize) {
            await (worker as any).reinitialize("eng", {
              tessedit_pageseg_mode: "6",
              preserve_interword_spaces: "1",
              tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:",
            });
          }
        }
        return worker;
      } catch {
        return null; // biar fallback ke Tesseract.recognize biasa
      }
    })();
  }
  if (!workerInst) workerInst = await workerPromise;
  return workerInst;
}

/* ====== PUBLIC API: OCR Serial Number ====== */
export async function recognizeSerialNumber(
  imageSource: Blob | string,
  opts?: { onProgress?: OcrProgress; enableBarcode?: boolean; perTryTimeoutMs?: number }
): Promise<string | null> {
  const onProgress = opts?.onProgress;
  const enableBarcode = opts?.enableBarcode ?? true;
  const perTryTimeoutMs = opts?.perTryTimeoutMs ?? 1200; // batas per percobaan agar UI nggak freeze

  try {
    // Pastikan sumber dalam bentuk dataURL (aman kalau modal DOM sudah di-close)
    const dataUrl = typeof imageSource === "string" ? imageSource : await blobToDataUrl(imageSource);

    // 1) Barcode (cepat) — kasih budget waktu
    if (enableBarcode) {
      onProgress?.({ status: "barcode", progress: 0 });
      const bc = await withTimeout(tryDecodeBarcodeFromDataUrl(dataUrl), 400);
      if (bc) {
        onProgress?.({ status: "done", progress: 100 });
        return bc;
      }
    }

    // 2) OCR — rotate + upscale, dua PSM, dengan timeout per percobaan
    onProgress?.({ status: "ocr", progress: 10 });
    const scaled = await scaleUpDataUrl(dataUrl, 3);
    const angles = [0, 90, 270] as const; // 180 jarang perlu, hemat waktu
    const psms = [6, 7] as const;

    // coba pakai worker lebih dulu (kalau ada)
    const worker = await ensureWorker();

    for (const psm of psms) {
      for (const ang of angles) {
        const du = ang === 0 ? scaled : await rotateDataUrl(scaled, ang);

        const doRecognize = async () => {
          if (worker && (worker as any).recognize) {
            const r = await (worker as any).recognize(du);
            return r;
          }
          // fallback ke Tesseract.recognize biasa
          // @ts-ignore
          return await Tesseract.recognize(du, "eng", {
            // @ts-ignore
            logger: (m: any) =>
              m?.status === "recognizing text" &&
              m?.progress != null &&
              onProgress?.({
                status: "ocr",
                progress: Math.min(99, Math.round(10 + m.progress * 80)),
              }),
            // @ts-ignore
            tessedit_pageseg_mode: String(psm),
            preserve_interword_spaces: "1",
          });
        };

        const result = await withTimeout(doRecognize(), perTryTimeoutMs);
        if (!result) {
          // timeout — lanjut percobaan lain supaya tidak lama
          continue;
        }

        const text = (result.data?.text ?? "").trim();
        // @ts-ignore
        const words = (result.data?.words ?? []) as Array<{ text: string }>;
        // @ts-ignore
        const lines = (result.data?.lines ?? []) as Array<{ text: string }>;
        const sn = extractSN(text, words, lines);
        if (sn && sn.length >= 8) {
          onProgress?.({ status: "done", progress: 100 });
          return sn;
        }
      }
    }

    onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." });
    return null;
  } catch (e: any) {
    onProgress?.({ status: "error", progress: 0, error: e?.message || "Gagal memproses OCR." });
    return null;
  }
}
