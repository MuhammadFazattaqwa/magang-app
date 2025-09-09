/* lib/ocr.ts — Fast SN OCR with time budget + optional server fallback */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import Tesseract from "tesseract.js";

/* ===== Types untuk progress OCR di UI ===== */
export type OCRPhase = "idle" | "barcode" | "ocr" | "server" | "done" | "error";
export interface OcrInfo { status: OCRPhase; progress: number; error?: string }
export type OcrProgress = (info: OcrInfo) => void;

type RecognizeOpts = {
  onProgress?: OcrProgress;
  enableBarcode?: boolean;
  /** batas waktu total (ms) untuk OCR lokal; sisanya (jika online) dialihkan ke server */
  timeBudgetMs?: number; // default 1500
  /** jika true & online → fallback ke /api/ocr/serial (POST {dataUrl}) */
  enableServerFallback?: boolean;
};

let workerPromise: Promise<any> | null = null;
let workerInst: any | null = null;

function isBrowser() { return typeof window !== "undefined"; }

/* ====== SN utils ====== */
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

/* ====== Canvas helpers (pre-processing) ====== */
function imgFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
}

function drawDownscaled(img: HTMLImageElement, targetMaxSide = 900) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const scale = Math.min(1, targetMaxSide / Math.max(W, H));
  const w = Math.max(32, Math.round(W * scale));
  const h = Math.max(32, Math.round(H * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return { c, ctx, w, h };
}

/** Kontras otomatis + adaptive threshold supaya tulisan lebih jelas */
function enhanceForOCR(src: HTMLCanvasElement) {
  const w = src.width, h = src.height;
  const ctx = src.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // 1) Grayscale + ambil histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g]++;
  }
  // 2) Contrast stretch (cut 1% tail)
  let acc = 0, low = 0, high = 255;
  const cut = (w * h) * 0.01;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > cut) { low = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > cut) { high = i; break; } }
  const rng = Math.max(1, high - low);
  for (let i = 0; i < d.length; i += 4) {
    let g = d[i];
    g = ((g - low) * 255 / rng) | 0;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  // 3) Adaptive threshold (mean blur 5x5 sederhana)
  const out = new Uint8ClampedArray(d.length);
  const S = new Uint32Array(w * h);
  // integral image
  for (let y = 0; y < h; y++) {
    let rowsum = 0;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      rowsum += d[idx];
      S[y * w + x] = rowsum + (y ? S[(y - 1) * w + x] : 0);
    }
  }
  const r = 3; // radius
  const k = 0.85; // threshold factor
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - r), y1 = Math.max(0, y - r);
      const x2 = Math.min(w - 1, x + r), y2 = Math.min(h - 1, y + r);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        S[y2 * w + x2] -
        (x1 ? S[y2 * w + (x1 - 1)] : 0) -
        (y1 ? S[(y1 - 1) * w + x2] : 0) +
        (x1 && y1 ? S[(y1 - 1) * w + (x1 - 1)] : 0);

      const idx = (y * w + x) * 4;
      const g = d[idx];
      const thr = (sum / area) * k;
      const v = g > thr ? 255 : 0;
      out[idx] = out[idx + 1] = out[idx + 2] = v;
      out[idx + 3] = 255;
    }
  }
  ctx.putImageData(new ImageData(out, w, h), 0, 0);
  return src;
}

/* ====== ZXing (barcode) ====== */
async function tryDecodeBarcodeFromCanvas(cv: HTMLCanvasElement): Promise<string | null> {
  try {
    if (!isBrowser()) return null;
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const img = new Image();
    img.src = cv.toDataURL("image/png");
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); });
    // @ts-ignore
    const result = await new BrowserMultiFormatReader().decodeFromImageElement(img as HTMLImageElement);
    const txt = (result as any)?.getText?.() ?? "";
    return selectBestSN(txt);
  } catch { return null; }
}

/* ====== Tesseract worker (v5) ====== */
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // @ts-ignore
      const w = await Tesseract.createWorker("eng", {});
      try {
        await (w as any).setParameters?.({
          tessedit_pageseg_mode: "7", // single text line / label
          preserve_interword_spaces: "1",
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:",
        });
      } catch {
        if ((w as any).reinitialize) {
          await (w as any).reinitialize("eng", {
            tessedit_pageseg_mode: "7",
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

/* ====== Helpers ====== */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.readAsDataURL(blob);
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

/* ====== Server fallback (opsional) ====== */
async function tryServerFallback(dataUrl: string, onProgress?: OcrProgress): Promise<string | null> {
  try {
    if (!navigator.onLine) return null;
    onProgress?.({ status: "server", progress: 20 });
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 5000); // server timeout 5s
    const res = await fetch("/api/ocr/serial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
      signal: ctrl.signal,
    });
    clearTimeout(id);
    if (!res.ok) return null;
    const json = await res.json();
    const sn = selectBestSN(String(json?.serial || json?.sn || ""));
    return sn || null;
  } catch { return null; }
}

/* ====== PUBLIC API ====== */
export async function recognizeSerialNumber(
  imageSource: Blob | string,
  opts?: RecognizeOpts
): Promise<string | null> {
  const onProgress = opts?.onProgress;
  const enableBarcode = opts?.enableBarcode ?? true;
  const timeBudgetMs = opts?.timeBudgetMs ?? 1500;
  const enableServerFallback = opts?.enableServerFallback ?? true;

  try {
    const started = Date.now();
    const dataUrl = typeof imageSource === "string" ? imageSource : await blobToDataUrl(imageSource);

    // Downscale + enhance (hemat CPU)
    const img = await imgFromDataUrl(dataUrl);
    const { c } = drawDownscaled(img, 900);
    enhanceForOCR(c);

    // 1) Barcode dulu (sangat cepat)
    onProgress?.({ status: "barcode", progress: 0 });
    if (enableBarcode) {
      const bc = await tryDecodeBarcodeFromCanvas(c);
      if (bc) { onProgress?.({ status: "done", progress: 100 }); return bc; }
    }

    // 2) OCR lokal — PSM 7; sudut 0 & 90 saja; target kecil
    onProgress?.({ status: "ocr", progress: 10 });
    const worker = await getWorker();

    const tryAngles: number[] = [0, 90];
    for (let i = 0; i < tryAngles.length; i++) {
      if (Date.now() - started > timeBudgetMs) break; // budget habis → berhenti
      const ang = tryAngles[i];
      const du = ang === 0 ? c.toDataURL("image/png") : await rotateDataUrl(c.toDataURL("image/png"), ang);

      // @ts-ignore
      const result = await (worker as any).recognize(du, {
        logger: (m: any) => {
          if (m?.status === "recognizing text" && m?.progress != null) {
            const p = Math.min(98, 10 + Math.round(m.progress * 80));
            onProgress?.({ status: "ocr", progress: p });
          }
        }
      });

      const text = (result?.data?.text ?? "").trim();
      const words = (result?.data?.words ?? []) as Array<{ text: string }>;
      const lines = (result?.data?.lines ?? []) as Array<{ text: string }>;
      const sn = extractSN(text, words, lines);
      if (sn && sn.length >= 8) { onProgress?.({ status: "done", progress: 100 }); return sn; }
    }

    // 3) Fallback server (jika masih gagal & online)
    if (enableServerFallback && navigator.onLine && Date.now() - started <= 8000) {
      const sn = await tryServerFallback(c.toDataURL("image/png"), onProgress);
      if (sn) { onProgress?.({ status: "done", progress: 100 }); return sn; }
    }

    onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." });
    return null;
  } catch (e: any) {
    onProgress?.({ status: "error", progress: 0, error: e?.message || "Gagal memproses OCR." });
    return null;
  }
}
