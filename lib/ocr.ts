/* eslint-disable @typescript-eslint/ban-ts-comment */
/* lib/ocr.ts – OCR SN super-cepat + anti “stuck 10%”
   Strategi:
   1) ZXing (barcode)
   2) Tesseract v5 (worker, CDN paths), PSM 7, 0° & 180°, binarize, timeout
   3) Optional: server fallback (/api/ocr/sn) — di-race biar ambil yang tercepat
*/

import Tesseract from "tesseract.js";

/* ================= Types ================= */
export type OCRPhase = "idle" | "barcode" | "ocr" | "done" | "error";
export interface OcrInfo { status: OCRPhase; progress: number; error?: string }
export type OcrProgress = (info: OcrInfo) => void;

/* ================= Utils ================= */
const isBrowser = () => typeof window !== "undefined";

/** Pangkas suffix revisi seperti "/r3", "(r3)", "-rev3", "ver:2", "r2", dst */
function stripRevisionSuffix(v: string) {
  if (!v) return v;
  let s = v.trim();

  // “…/r3”, “…/rev2”, “…/v1”
  s = s.replace(/\/\s*(?:r|rev|v|ver)\s*[:\-]?\s*[0-9]+[a-z]?$/i, "");

  // “…(r3)”, “…(rev2)”, “…(ver:2)”
  s = s.replace(/\(\s*(?:r|rev|v|ver)\s*[:\-]?\s*[0-9]+[a-z]?\s*\)$/i, "");

  // “… -rev3”, “… r1”, “… ver:2”, juga “hw1”, “fw2”
  s = s.replace(
    /(?:[-\s]|^)(?:rev(?:ision)?|r|v|ver|hw|fw)\s*[:\-]?\s*[0-9]+[a-z]?$/i,
    ""
  );

  // bersihkan karakter non-alfanumerik di ujung
  s = s.replace(/[^\w]+$/g, "");
  return s.trim();
}

export function normalizeSN(val: string) {
  let out = (val || "").trim().toUpperCase().replace(/\s+/g, "");

  // mapping umum misread: O↔0, I↔1, S↔5, B↔8, Q→0 saat berdampingan digit
  out = out
    .replace(/Q(?=\d)/g, "0")
    .replace(/(?<=\d)O(?=\d)/g, "0")
    .replace(/O(?=\d)/g, "0")
    .replace(/(?<=\d)[IL](?=\d)/g, "1")
    .replace(/(?<=\d)B(?=\d)/g, "8")
    .replace(/(?<=\d)S(?=\d)/g, "5");

  // pangkas info revisi
  out = stripRevisionSuffix(out);

  // buang selain huruf/angka/(-_/)
  return out.replace(/[^\w\-\/]/g, "");
}

function selectBestSN(raw: string): string | null {
  // pangkas revisi dulu, lalu ambil kiri sebelum '/'
  const base = stripRevisionSuffix(raw);
  const left = base.split("/")[0];

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
  for (const L of (lines || [])) {
    if (labelRe.test(L.text)) {
      const sn = selectBestSN((L.text.split(labelRe)[1] ?? ""));
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

  // Pattern global
  const T = (ocrText || "").toUpperCase();
  const mg = T.match(new RegExp(labelRe.source + String.raw`\s*[:#-]?\s*([A-Z0-9\s\-\/]{5,})`, "i"));
  if (mg?.[1]) {
    const sn = selectBestSN(mg[1]);
    if (sn) return sn;
  }

  // Baris berlabel → deret panjang setelahnya
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

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.readAsDataURL(blob);
  });
}

/* Downscale + Binarize ringan (Otsu) – bikin OCR lebih cepat & akurat */
function otsuThreshold(gray: Uint8ClampedArray) {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[i]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, varMax = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB; if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > varMax) { varMax = between; threshold = t; }
  }
  return threshold;
}

async function preprocessDataUrl(dataUrl: string, maxSide = 900): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(16, Math.round(img.naturalWidth * s));
      const h = Math.max(16, Math.round(img.naturalHeight * s));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const gray = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 0; i < imgData.data.length; i += 4, j++) {
        const r = imgData.data[i], g = imgData.data[i + 1], b = imgData.data[i + 2];
        gray[j] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      }
      const th = otsuThreshold(gray);
      for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
        const v = gray[j] > th ? 255 : 0;
        imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = v;
        imgData.data[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
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

/* ============ ZXing (Barcode) ============ */
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
    const sn = selectBestSN(txt);
    return sn ? stripRevisionSuffix(sn) : null;
  } catch { return null; }
}

/* ============ Tesseract worker singleton (v5) ============ */
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
          tessedit_pageseg_mode: "7", // Single line → cepat & cocok SN
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

/* ============ OCR lokal dengan timeout & progress ============ */
async function recognizeLocal(
  dataUrl: string,
  timeBudgetMs: number,
  onProgress?: OcrProgress
): Promise<string | null> {
  const worker = await getWorker();

  // heartbeat agar UI tidak “diam” di 10%
  let lastTick = Date.now();
  const beat = setInterval(() => {
    if (Date.now() - lastTick > 800 && onProgress) onProgress({ status: "ocr", progress: 12 });
  }, 400);

  try {
    const res = await Promise.race([
      (async () => {
        const { data } = await (worker as any).recognize(dataUrl, {
          // @ts-ignore
          logger: (m: any) => {
            lastTick = Date.now();
            if (m?.status === "recognizing text" && m?.progress != null && onProgress) {
              const p = Math.max(13, Math.min(99, Math.round(12 + m.progress * 85)));
              onProgress({ status: "ocr", progress: p });
            }
          },
        });
        const text = (data?.text ?? "").trim();
        const words = (data?.words ?? []) as Array<{ text: string }>;
        const lines = (data?.lines ?? []) as Array<{ text: string }>;
        const sn = extractSN(text, words, lines);
        return sn && sn.length >= 8 ? stripRevisionSuffix(sn) : null;
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeBudgetMs)),
    ]);
    return (res as string | null) || null;
  } finally {
    clearInterval(beat);
  }
}

/* ============ Server fallback (opsional) ============ */
const SERVER_OCR_ENDPOINT = "/api/ocr/sn"; // siapkan endpoint ini kalau ingin fallback

async function recognizeServer(dataUrl: string): Promise<string | null> {
  try {
    const res = await fetch(SERVER_OCR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: dataUrl }),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => ({}));
    const sn = (j?.sn as string) || "";
    return sn?.length ? normalizeSN(sn) : null;
  } catch {
    return null;
  }
}

/* ============ Simple mutex (hindari 2 OCR bersamaan di HP low-end) ============ */
let lock = Promise.resolve();
async function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const enter = lock.then(fn, fn);
  lock = enter.then(() => undefined, () => undefined);
  return enter;
}

/* ============ PUBLIC API ============ */
export async function recognizeSerialNumber(
  imageSource: Blob | string,
  opts?: {
    onProgress?: OcrProgress;
    enableBarcode?: boolean;
    timeBudgetMs?: number;           // total waktu OCR lokal (displit ke beberapa percobaan)
    enableServerFallback?: boolean;  // true = race dengan server
  }
): Promise<string | null> {
  return withMutex(async () => {
    const onProgress = opts?.onProgress;
    const enableBarcode = opts?.enableBarcode ?? true;
    const timeBudgetMs = opts?.timeBudgetMs ?? 1600;
    const enableServerFallback = opts?.enableServerFallback ?? true;

    try {
      const dataUrl = typeof imageSource === "string" ? imageSource : await blobToDataUrl(imageSource);

      // 1) Barcode – paling cepat
      onProgress?.({ status: "barcode", progress: 0 });
      if (enableBarcode) {
        const bc = await tryDecodeBarcodeFromDataUrl(dataUrl);
        if (bc) { onProgress?.({ status: "done", progress: 100 }); return stripRevisionSuffix(bc); }
      }

      // 2) Preprocess + kandidat (0°, 180°) — cepat
      onProgress?.({ status: "ocr", progress: 10 });
      const base = await preprocessDataUrl(dataUrl, 900);
      const rot180 = await rotateDataUrl(base, 180);
      const candidates = [base, rot180];

      // 3) Race: OCR lokal (dengan budget dibagi) vs server (opsional)
      const perTry = Math.max(500, Math.floor(timeBudgetMs / candidates.length));
      const localTask = (async () => {
        for (const du of candidates) {
          const sn = await recognizeLocal(du, perTry, onProgress);
          if (sn) return sn;
        }
        return null;
      })();

      const serverTask =
        enableServerFallback && typeof navigator !== "undefined" && navigator.onLine
          ? recognizeServer(base)
          : Promise.resolve<string | null>(null);

      const winner = await Promise.race([
        localTask.then((v) => ({ who: "local", v })),
        serverTask.then((v) => ({ who: "server", v })),
      ]);

      const first = winner.v;
      if (first) { onProgress?.({ status: "done", progress: 100 }); return first; }

      // Jika pemenang pertama gagal, tunggu yang satunya sebentar
      const second = winner.who === "local" ? await serverTask : await localTask;
      if (second) { onProgress?.({ status: "done", progress: 100 }); return second; }

      onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." });
      return null;
    } catch (e: any) {
      onProgress?.({ status: "error", progress: 0, error: e?.message || "Gagal memproses OCR." });
      return null;
    }
  });
}
