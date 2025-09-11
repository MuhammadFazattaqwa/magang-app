/* eslint-disable @typescript-eslint/ban-ts-comment */
import Tesseract from "tesseract.js";

export type OCRPhase = "idle" | "barcode" | "ocr" | "done" | "error";
export interface OcrInfo { status: OCRPhase; progress: number; error?: string }
export type OcrProgress = (info: OcrInfo) => void;

/* ===== Normalizer / Selector ===== */
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
    const sn = selectBestSN(mg[1]); if (sn) return sn;
  }
  const line = (T.split(/\r?\n/).find((l) => labelRe.test(l)) || "").replace(labelRe, "");
  const loose = line.match(/[A-Z0-9\-\/]{6,}/i);
  if (loose?.[0]) {
    const sn = selectBestSN(loose[0]); if (sn) return sn;
  }
  const digits = T.match(/\b\d{8,}\b/);
  if (digits?.[0]) {
    const sn = selectBestSN(digits[0]); if (sn) return sn;
  }
  return "";
}

/* ===== Small utils ===== */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.readAsDataURL(blob);
  });
}
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = (e) => rej(e);
    img.src = src;
  });
}
async function scaleUpDataUrl(dataUrl: string, factor = 2.5): Promise<string> {
  const img = await loadImg(dataUrl);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * factor));
  c.height = Math.max(1, Math.round(img.naturalHeight * factor));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}
async function rotateDataUrl(dataUrl: string, deg: number): Promise<string> {
  const img = await loadImg(dataUrl);
  const rad = (deg * Math.PI) / 180;
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  if (deg % 180 === 0) { c.width = w; c.height = h; } else { c.width = h; c.height = w; }
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -w / 2, -h / 2);
  return c.toDataURL("image/png");
}

/* Binarize (Otsu-like simple threshold) for digits-only pass */
async function binarizeDataUrl(dataUrl: string): Promise<string> {
  const img = await loadImg(dataUrl);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const im = ctx.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  // compute histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    hist[g]++; d[i] = d[i + 1] = d[i + 2] = g;
  }
  // otsu
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sumB = 0, maxVar = 0, thresh = 128;
  const total = (c.width * c.height);
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (wB === 0) continue;
    const wF = total - wB; if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB; const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; thresh = t; }
  }
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] > thresh ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return c.toDataURL("image/png");
}

/* Crop bottom band (teks “S/n: …” di bawah barcode) */
async function cropBottomBand(dataUrl: string, band = 0.45): Promise<string> {
  const img = await loadImg(dataUrl);
  const c = document.createElement("canvas");
  const x = 0, y = Math.floor(img.naturalHeight * (1 - band));
  const w = img.naturalWidth, h = Math.max(8, Math.floor(img.naturalHeight * band));
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return c.toDataURL("image/png");
}

/* ZXing first */
async function tryDecodeBarcodeFromDataUrl(dataUrl: string): Promise<string | null> {
  try {
    if (typeof window === "undefined") return null;
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const imgEl = await loadImg(dataUrl);
    // @ts-ignore
    const result = await new BrowserMultiFormatReader().decodeFromImageElement(imgEl as HTMLImageElement);
    const txt = (result as any)?.getText?.() ?? "";
    return selectBestSN(txt);
  } catch { return null; }
}

/* ===== PUBLIC ===== */
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

    // 1) Barcode
    if (enableBarcode) {
      const bc = await tryDecodeBarcodeFromDataUrl(dataUrl);
      if (bc) { onProgress?.({ status: "done", progress: 100 }); return bc; }
    }

    // 1b) KASUS LABEL KECIL: fokus ke pita bawah barcode → OCR DIGITS ONLY
    // sangat cepat untuk stiker “S/n: 00060…”
    {
      const band = await cropBottomBand(dataUrl, 0.5);
      const scaledBand = await scaleUpDataUrl(band, 4);   // agresif
      const binBand = await binarizeDataUrl(scaledBand);

      const smallAngles = [-12, -6, 0, 6, 12] as const;
      for (const ang of smallAngles) {
        const du = ang === 0 ? binBand : await rotateDataUrl(binBand, ang);
        // @ts-ignore
        const res = await Tesseract.recognize(du, "eng", {
          // @ts-ignore
          tessedit_char_whitelist: "0123456789",
          preserve_interword_spaces: "1",
          // @ts-ignore
          tessedit_pageseg_mode: "7", // single line
          // @ts-ignore
          logger: (m) => m?.status === "recognizing text" && m?.progress != null &&
            onProgress?.({ status: "ocr", progress: Math.min(95, Math.round(5 + m.progress * 60)) }),
        });
        const text = (res.data?.text ?? "").replace(/\s+/g, "");
        const match = text.match(/\d{12,}/);
        if (match?.[0]) { onProgress?.({ status: "done", progress: 100 }); return match[0]; }
      }
    }

    // 2) OCR umum (seperti versi kamu – cepat)
    const scaled = await scaleUpDataUrl(dataUrl, 2.5);
    const anglesFast = [0] as const;
    const anglesDeep = [90, 180, 270] as const;
    const psmsFast = [6] as const;
    const psmsDeep = [7] as const;

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

    const fast = await tryPSM(6, anglesFast);
    if (fast) { onProgress?.({ status: "done", progress: 100 }); return fast; }
    if (mode === "fast") { onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." }); return null; }

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
