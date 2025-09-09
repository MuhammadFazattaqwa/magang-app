/* eslint-disable @typescript-eslint/ban-ts-comment */
/* lib/ocr.ts – OCR SN cepat dengan fallback & timeout */

import Tesseract from "tesseract.js";

/* ====== Types untuk UI progress ====== */
export type OCRPhase = "idle" | "barcode" | "ocr" | "done" | "error";
export interface OcrInfo { status: OCRPhase; progress: number; error?: string }
export type OcrProgress = (info: OcrInfo) => void;

/* ====== Utils umum ====== */
const isBrowser = () => typeof window !== "undefined";

export function normalizeSN(val: string) {
  let out = (val || "").trim().toUpperCase().replace(/\s+/g, "");
  out = out.replace(/Q(?=\d)/g, "0").replace(/(?<=\d)O(?=\d)/g, "0").replace(/O(?=\d)/g, "0");
  out = out.replace(/(?<=\d)[IL](?=\d)/g, "1").replace(/(?<=\d)B(?=\d)/g, "8").replace(/(?<=\d)S(?=\d)/g, "5");
  return out.replace(/[^\w\-\/]/g, "");
}

function selectBestSN(raw: string): string | null {
  const left = raw.split("/")[0];
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

  for (const L of (lines || [])) {
    if (labelRe.test(L.text)) {
      const sn = selectBestSN((L.text.split(labelRe)[1] ?? ""));
      if (sn) return sn;
    }
  }

  if (words?.length) {
    for (let i = 0; i < words.length; i++) {
      if (labelRe.test(words[i].text)) {
        const sn = selectBestSN([(words[i + 1]?.text ?? ""), (words[i + 2]?.text ?? "")].join(" "));
        if (sn) return sn;
      }
    }
  }

  const T = (ocrText || "").toUpperCase();
  const mg = T.match(new RegExp(labelRe.source + String.raw`\s*[:#-]?\s*([A-Z0-9\s\-\/]{5,})`, "i"));
  if (mg?.[1]) {
    const sn = selectBestSN(mg[1]);
    if (sn) return sn;
  }

  const line = (T.split(/\r?\n/).find((l) => labelRe.test(l)) || "").replace(labelRe, "");
  const loose = line.match(/[A-Z0-9\-\/]{6,}/i);
  if (loose?.[0]) {
    const sn = selectBestSN(loose[0]);
    if (sn) return sn;
  }

  const digits = T.match(/\b\d{8,}\b/);
  if (digits?.[0]) {
    const sn = selectBestSN(digits[0]);
    if (sn) return sn;
  }

  return "";
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.readAsDataURL(blob);
  });
}

async function scaleDataUrl(dataUrl: string, maxSide = 900, upscale = 1): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      const s = Math.min(1, maxSide / Math.max(W, H)) * Math.max(1, upscale);
      const w = Math.max(16, Math.round(W * s));
      const h = Math.max(16, Math.round(H * s));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
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
      const w = img.naturalWidth, h = img.naturalHeight;
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

/* ====== Barcode (ZXing) ====== */
async function tryDecodeBarcodeFromDataUrl(dataUrl: string): Promise<string | null> {
  try {
    if (!isBrowser()) return null;
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const imgEl = new Image();
    imgEl.src = dataUrl;
    await new Promise<void>((res, rej) => { imgEl.onload = () => res(); imgEl.onerror = () => rej(new Error("img load")); });
    // @ts-ignore
    const result = await new BrowserMultiFormatReader().decodeFromImageElement(imgEl as HTMLImageElement);
    const txt = (result as any)?.getText?.() ?? "";
    return selectBestSN(txt);
  } catch { return null; }
}

/* ====== Tesseract singleton (v5) dengan CDN path ======
   Supaya tidak macet di PWA, pakai path explicit dari jsDelivr. */
let workerPromise: Promise<any> | null = null;
let workerInst: any | null = null;

function getCdnPaths() {
  const base = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/";
  return {
    workerPath: base + "worker.min.js",
    corePath:   base + "tesseract-core.wasm.js",
    langPath:   base + "langs/",
  };
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { workerPath, corePath, langPath } = getCdnPaths();
      // @ts-ignore
      const w = await Tesseract.createWorker("eng", { workerPath, corePath, langPath } as any);
      try {
        await (w as any).setParameters?.({
          tessedit_pageseg_mode: "6",
          preserve_interword_spaces: "1",
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:",
        });
      } catch {
        if ((w as any).reinitialize) {
          await (w as any).reinitialize("eng", {
            tessedit_pageseg_mode: "6",
            preserve_interword_spaces: "1",
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:",
          });
        }
      }
      return w;
    })();
  }
  if (!workerInst) workerInst = await workerPromise;
  return workerInst;
}

/* ====== OCR lokal dengan timeout ====== */
async function recognizeLocal(
  dataUrl: string,
  timeBudgetMs: number,
  onProgress?: OcrProgress
): Promise<string | null> {
  const worker = await getWorker();

  // “heartbeat” agar UI tak berhenti di 10%
  let lastTick = Date.now();
  const beat = setInterval(() => {
    const age = Date.now() - lastTick;
    if (age > 800 && onProgress) onProgress({ status: "ocr", progress: 10 });
  }, 400);

  try {
    const res = await Promise.race([
      (async () => {
        // logger progress dari tesseract
        const { data } = await (worker as any).recognize(dataUrl, {
          // @ts-ignore
          logger: (m: any) => {
            lastTick = Date.now();
            if (m?.status === "recognizing text" && m?.progress != null && onProgress) {
              const p = Math.max(11, Math.min(99, Math.round(10 + m.progress * 85)));
              onProgress({ status: "ocr", progress: p });
            }
          },
        });
        const text = (data?.text ?? "").trim();
        const words = (data?.words ?? []) as Array<{ text: string }>;
        const lines = (data?.lines ?? []) as Array<{ text: string }>;
        const sn = extractSN(text, words, lines);
        return sn && sn.length >= 8 ? sn : null;
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeBudgetMs)),
    ]);

    return (res as string | null) || null;
  } finally {
    clearInterval(beat);
  }
}

/* ====== Fallback server (opsional) ====== */
async function recognizeServer(dataUrl: string): Promise<string | null> {
  try {
    const res = await fetch("/api/ocr/sn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: dataUrl }),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => ({}));
    const sn = (j?.sn as string) || "";
    return sn?.length ? normalizeSN(sn) : null;
  } catch { return null; }
}

/* ====== PUBLIC API ====== */
export async function recognizeSerialNumber(
  imageSource: Blob | string,
  opts?: {
    onProgress?: OcrProgress;
    enableBarcode?: boolean;
    timeBudgetMs?: number;           // batas waktu OCR lokal
    enableServerFallback?: boolean;  // coba /api/ocr/sn jika online
  }
): Promise<string | null> {
  const onProgress = opts?.onProgress;
  const enableBarcode = opts?.enableBarcode ?? true;
  const timeBudgetMs = opts?.timeBudgetMs ?? 1800;
  const enableServerFallback = opts?.enableServerFallback ?? true;

  try {
    const dataUrl = typeof imageSource === "string" ? imageSource : await blobToDataUrl(imageSource);

    onProgress?.({ status: "barcode", progress: 0 });
    if (enableBarcode) {
      const bc = await tryDecodeBarcodeFromDataUrl(dataUrl);
      if (bc) { onProgress?.({ status: "done", progress: 100 }); return bc; }
    }

    // Persiapkan kandidat gambar: scale dan rotasi ringan
    onProgress?.({ status: "ocr", progress: 10 });
    const base = await scaleDataUrl(dataUrl, 900, 1.6);
    const candidates = [base, await rotateDataUrl(base, 90)];

    // Alokasikan waktu per kandidat
    const perTry = Math.max(600, Math.floor(timeBudgetMs / candidates.length));

    for (const du of candidates) {
      const sn = await recognizeLocal(du, perTry, onProgress);
      if (sn) { onProgress?.({ status: "done", progress: 100 }); return sn; }
    }

    // Fallback server jika diizinkan
    if (enableServerFallback && typeof navigator !== "undefined" && navigator.onLine) {
      const sn = await recognizeServer(base);
      if (sn) { onProgress?.({ status: "done", progress: 100 }); return sn; }
    }

    onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." });
    return null;
  } catch (e: any) {
    onProgress?.({ status: "error", progress: 0, error: e?.message || "Gagal memproses OCR." });
    return null;
  }
}
