/* lib/auto-crop.ts
   Auto-crop cepat & ringan untuk PWA:
   Urutan: Barcode → OCR label SN (Tesseract v5) → COCO-SSD (tfjs) → Saliency (Sobel+bright)
   - Semua model di-load lazy (hanya di browser) dan di-reuse (singleton)
   - Bekerja pada dataURL (hasil FileReader) agar tak perlu I/O tambahan
*/

import Tesseract from "tesseract.js";

/* ===== Types ===== */
export type Box = { x: number; y: number; w: number; h: number };
export type Suggestion = { box: Box; naturalW: number; naturalH: number };

/* ===== Caches / Singletons (browser only) ===== */
let cocoModel: any | null = null;
let tesseractWorker: any | null = null;
let tesseractWorkerPromise: Promise<any> | null = null;

/* ===== Utilities ===== */
function isBrowser() {
  return typeof window !== "undefined";
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = dataUrl;
  });
}

function padClamp(b: Box, padRatio: number, W: number, H: number): Box {
  const pad = Math.round(Math.max(b.w, b.h) * padRatio);
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  const w = Math.min(W - x, b.w + pad * 2);
  const h = Math.min(H - y, b.h + pad * 2);
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function percentile(arr: Float32Array, p: number): number {
  const a = Array.from(arr).sort((x, y) => x - y);
  const idx = clamp(Math.floor((p / 100) * a.length), 0, Math.max(0, a.length - 1));
  return a[idx] ?? 0;
}

/* Morphology (dipakai di saliency) — ketik generik agar aman di TS terbaru */
function dilate(src: Uint8Array<ArrayBufferLike>, w: number, h: number, r = 1) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let yy = -r; yy <= r && !v; yy++) {
        const ny = y + yy;
        if (ny < 0 || ny >= h) continue;
        for (let xx = -r; xx <= r; xx++) {
          const nx = x + xx;
          if (nx < 0 || nx >= w) continue;
          if (src[ny * w + nx]) {
            v = 1;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
function erode(src: Uint8Array<ArrayBufferLike>, w: number, h: number, r = 1) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let yy = -r; yy <= r && v; yy++) {
        const ny = y + yy;
        if (ny < 0 || ny >= h) {
          v = 0;
          break;
        }
        for (let xx = -r; xx <= r; xx++) {
          const nx = x + xx;
          if (nx < 0 || nx >= w) {
            v = 0;
            break;
          }
          if (!src[ny * w + nx]) {
            v = 0;
            break;
          }
        }
      }
      out[y * w + x] = v ? 1 : 0;
    }
  }
  return out;
}

/* Downscale cepat untuk pre-processing / mempercepat model */
function downscaleTo(img: HTMLImageElement, maxSide = 640) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(16, Math.round(W * scale));
  const h = Math.max(16, Math.round(H * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, w, h, scale, W, H };
}

/* Timeout helper agar tiap tahap punya budget waktu */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T | null> {
  let to: any;
  const timeout = new Promise<null>((resolve) => {
    to = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {}
      resolve(null);
    }, ms);
  });
  return Promise.race([p.then((v) => (clearTimeout(to), v)), timeout]) as Promise<T | null>;
}

/* ===== 1) Barcode bbox (ZXing) ===== */
async function detectBarcodeBox(dataUrl: string): Promise<Box | null> {
  try {
    if (!isBrowser()) return null;
    const [{ BrowserMultiFormatReader }] = (await Promise.all([
      import("@zxing/browser"),
      // kecilkan gambar saat decode barcode agar cepat
    ])) as any[];

    const img = await loadImage(dataUrl);
    // ZXing lebih cepat kalau diberikan element kecil → downscale dulu:
    const { canvas } = downscaleTo(img, 900);
    const el = new Image();
    el.src = canvas.toDataURL("image/png");
    await new Promise((r, j) => { el.onload = () => r(null); el.onerror = j; });

    // @ts-ignore
    const res = await new BrowserMultiFormatReader().decodeFromImageElement(el as HTMLImageElement);
    // @ts-ignore
    const pts = res?.getResultPoints?.() || (res?.resultPoints ?? []);
    if (!pts?.length) return null;

    // Ambil min/max point → bbox
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of pts) {
      const x = p.getX ? p.getX() : p.x;
      const y = p.getY ? p.getY() : p.y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    let w = Math.round(maxX - minX);
    let h = Math.round(maxY - minY);
    if (w <= 2 || h <= 2) return null;

    // Skala balik ke natural
    const scaleX = img.naturalWidth / el.naturalWidth;
    const scaleY = img.naturalHeight / el.naturalHeight;

    const x0 = Math.round(minX * scaleX);
    const y0 = Math.round(minY * scaleY);
    w = Math.round(w * scaleX);
    h = Math.round(h * scaleY);

    return padClamp({ x: x0, y: y0, w, h }, 0.25, img.naturalWidth, img.naturalHeight);
  } catch {
    return null;
  }
}

/* ===== 2) Tesseract v5: cari label SN/Serial → gabung bbox kata di dekatnya ===== */
async function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      // v5: bahasa adalah arg pertama
      const worker = await Tesseract.createWorker("eng", {
        // logger: (m) => console.log("[tesseract]", m), // aktifkan jika perlu
      } as any);

      // Set parameter via setParameters (akses via any agar lolos typing).
      try {
        await (worker as any).setParameters?.({
          tessedit_pageseg_mode: "6", // SINGLE_BLOCK
          preserve_interword_spaces: "1",
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:",
        });
      } catch {
        // fallback sebagian build expose reinitialize(lang, params)
        if ((worker as any).reinitialize) {
          await (worker as any).reinitialize("eng", {
            tessedit_pageseg_mode: "6",
            preserve_interword_spaces: "1",
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:",
          });
        }
      }
      return worker;
    })();
  }
  if (!tesseractWorker) tesseractWorker = await tesseractWorkerPromise;
  return tesseractWorker;
}

async function detectSerialTextBox(dataUrl: string, natW: number, natH: number): Promise<Box | null> {
  try {
    if (!isBrowser()) return null;

    // Downscale ke 900px max agar OCR cepat tapi tetap detail teks
    const img = await loadImage(dataUrl);
    const { canvas, scale } = downscaleTo(img, 900);

    const worker = await getTesseractWorker();
    const { data } = await (worker as any).recognize(canvas);

    const words =
      (data?.words as Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>) ||
      [];

    if (!words.length) return null;

    // Cari label SN / SERIAL di sekitar kata
    const labelRe = /\b(?:S\/?N|SERIAL(?:\s*NO\.?|(?:\s*NUMBER)?))\b/i;

    for (let i = 0; i < words.length; i++) {
      if (!words[i]?.text) continue;
      if (labelRe.test(words[i].text)) {
        const take = [words[i], words[i + 1], words[i + 2]].filter(Boolean);
        const xs = take.map((w) => w!.bbox.x0);
        const ys = take.map((w) => w!.bbox.y0);
        const xe = take.map((w) => w!.bbox.x1);
        const ye = take.map((w) => w!.bbox.y1);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const w = Math.max(...xe) - x;
        const h = Math.max(...ye) - y;

        // rescale ke ukuran natural
        const inv = 1 / scale;
        const bx = Math.round(x * inv);
        const by = Math.round(y * inv);
        const bw = Math.round(w * inv);
        const bh = Math.round(h * inv);

        return padClamp({ x: bx, y: by, w: bw, h: bh }, 0.25, natW, natH);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/* ===== 3) COCO-SSD: objek umum ===== */
async function ensureCoco() {
  if (cocoModel || !isBrowser()) return cocoModel;
  const tf = await import("@tensorflow/tfjs");
  // @ts-ignore
  await (tf as any).ready?.();
  // @ts-ignore
  cocoModel = await (await import("@tensorflow-models/coco-ssd")).load({
    base: "lite_mobilenet_v2",
  });
  return cocoModel;
}

function preferredClassesFor(name?: string): string[] {
  const n = (name || "").toLowerCase();
  // Contoh penyesuaian label jika kategori tertentu
  if (/monitor|tv|display/.test(n)) return ["tv"];
  if (/router|modem|access\s*point|ap\b/.test(n)) return ["router", "laptop", "cell phone"]; // fallback umum
  return [];
}

async function detectGenericObjectBox(dataUrl: string, name?: string): Promise<Box | null> {
  try {
    await ensureCoco();
    const img = await loadImage(dataUrl);

    // Percepat: jalankan deteksi di resolusi moderat
    const { canvas } = downscaleTo(img, 768);
    const el = new Image();
    el.src = canvas.toDataURL("image/png");
    await new Promise((r, j) => { el.onload = () => r(null); el.onerror = j; });

    // @ts-ignore
    const preds = (await cocoModel.detect(el, 15)) as Array<{
      class: string;
      score: number;
      bbox: [number, number, number, number];
    }>;
    const picks = preds.filter((p) => p.score >= 0.5);
    if (!picks.length) return null;

    const pref = preferredClassesFor(name);
    let best = picks[0];
    if (pref.length) {
      const byPref = picks.filter((p) => pref.includes(p.class));
      best = (byPref.length ? byPref : picks).sort(
        (a, b) => b.score - a.score || b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3]
      )[0];
    } else {
      best = picks.sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3])[0];
    }

    const [x, y, w, h] = best.bbox.map((v) => Math.round(v)) as [
      number,
      number,
      number,
      number
    ];

    // Skala balik ke natural
    const scaleX = img.naturalWidth / el.naturalWidth;
    const scaleY = img.naturalHeight / el.naturalHeight;

    const bx = Math.round(x * scaleX);
    const by = Math.round(y * scaleY);
    const bw = Math.round(w * scaleX);
    const bh = Math.round(h * scaleY);

    return padClamp({ x: bx, y: by, w: bw, h: bh }, 0.15, img.naturalWidth, img.naturalHeight);
  } catch {
    return null;
  }
}

/* ===== 4) SALIENCY v2: edge (Sobel) + bright region + closing + scoring ===== */
async function detectSaliencyBox(dataUrl: string): Promise<Box | null> {
  const img = await loadImage(dataUrl);
  const { ctx, w, h, scale, W, H } = downscaleTo(img, 640);
  const { data } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  let globalSum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[j] = g;
    globalSum += g;
  }
  const globalMean = globalSum / (w * h);

  const mag = new Float32Array(w * h);
  const KX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const KY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sx = 0,
        sy = 0,
        k = 0;
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          const v = gray[(y + yy) * w + (x + xx)];
          sx += KX[k] * v;
          sy += KY[k] * v;
          k++;
        }
      }
      mag[y * w + x] = Math.hypot(sx, sy);
    }
  }

  const EDGE_P = 92,
    BRIGHT_P = 90;
  const edgeTh = percentile(mag, EDGE_P);
  const brightTh = percentile(gray, BRIGHT_P);

  const edgeMask: Uint8Array<ArrayBufferLike> = new Uint8Array(w * h);
  const brightMask: Uint8Array<ArrayBufferLike> = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    edgeMask[i] = mag[i] >= edgeTh ? 1 : 0;
    brightMask[i] = gray[i] >= brightTh ? 1 : 0;
  }

  let mask: Uint8Array<ArrayBufferLike> = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = edgeMask[i] | brightMask[i] ? 1 : 0;

  mask = dilate(mask, w, h, 3);
  mask = erode(mask, w, h, 2);

  const seen: Uint8Array<ArrayBufferLike> = new Uint8Array(w * h);
  let bestScore = 0;
  let bestBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  const stack = new Int32Array(w * h * 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx] || (seen as any)[idx]) continue;

      let top = 0;
      stack[top++] = x;
      stack[top++] = y;
      (seen as any)[idx] = 1;

      let minx = x,
        miny = y,
        maxx = x,
        maxy = y;
      let cnt = 0,
        sumG = 0,
        edgeCnt = 0;

      while (top) {
        const yy = stack[--top],
          xx = stack[--top];
        const ii = yy * w + xx;

        cnt++;
        sumG += gray[ii];
        if (edgeMask[ii]) edgeCnt++;

        if (xx < minx) minx = xx;
        if (yy < miny) miny = yy;
        if (xx > maxx) maxx = xx;
        if (yy > maxy) maxy = yy;

        const tryPush = (nx: number, ny: number) => {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
          const ni = ny * w + nx;
          if (!mask[ni] || (seen as any)[ni]) return;
          (seen as any)[ni] = 1;
          stack[top++] = nx;
          stack[top++] = ny;
        };

        tryPush(xx + 1, yy);
        tryPush(xx - 1, yy);
        tryPush(xx, yy + 1);
        tryPush(xx, yy - 1);
      }

      const bw = maxx - minx + 1,
        bh = maxy - miny + 1;
      const aspect = bw / bh;
      const area = bw * bh;
      const meanG = sumG / Math.max(1, cnt);
      const contrast = Math.max(0, meanG - globalMean);

      let score = (edgeCnt + 1) * (1 + contrast / 40) * Math.sqrt(cnt);
      if (aspect < 0.2 || aspect > 5) score *= 0.6;
      if (area < w * h * 0.02) score *= 0.7;

      if (score > bestScore) {
        bestScore = score;
        bestBox = { x0: minx, y0: miny, x1: maxx, y1: maxy };
      }
    }
  }

  if (!bestBox) return null;

  // Rescale ke natural
  const inv = 1 / scale;
  const bx = Math.round(bestBox.x0 * inv);
  const by = Math.round(bestBox.y0 * inv);
  const bw2 = Math.round((bestBox.x1 - bestBox.x0 + 1) * inv);
  const bh2 = Math.round((bestBox.y1 - bestBox.y0 + 1) * inv);

  return padClamp({ x: bx, y: by, w: bw2, h: bh2 }, 0.18, W, H);
}

/* ===== PUBLIC API =====
   suggestAutoCrop(dataUrl, categoryName?)
   - Mengembalikan bounding box crop yang disarankan dengan urutan:
     1) Barcode → 2) OCR label SN → 3) COCO-SSD → 4) Saliency
   - Tiap tahap diberi timeout supaya UI tetap responsif
*/
export async function suggestAutoCrop(
  dataUrl: string,
  categoryName?: string
): Promise<Suggestion | null> {
  if (!isBrowser()) return null;

  const img = await loadImage(dataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  // Heuristik: jika nama kategori mengandung SN/Serial → prioritaskan OCR/barcode
  const isSerialLike = /\b(s\/?n|serial)\b/i.test(categoryName || "");

  // 1) Barcode (cepat), budget 350ms
  const barcode = await withTimeout(detectBarcodeBox(dataUrl), 350);
  if (barcode) return { box: barcode, naturalW: W, naturalH: H };

  // 2) OCR label SN (kalau kategori serial, pakai budget lebih besar), else 500ms
  if (isSerialLike) {
    const snBox = await withTimeout(detectSerialTextBox(dataUrl, W, H), 900);
    if (snBox) return { box: snBox, naturalW: W, naturalH: H };
  } else {
    const snQuick = await withTimeout(detectSerialTextBox(dataUrl, W, H), 500);
    if (snQuick) return { box: snQuick, naturalW: W, naturalH: H };
  }

  // 3) COCO-SSD (model umum), budget 850ms
  const coco = await withTimeout(detectGenericObjectBox(dataUrl, categoryName), 850);
  if (coco) return { box: coco, naturalW: W, naturalH: H };

  // 4) Saliency (murni CPU, tanpa model), budget 400ms
  const sal = await withTimeout(detectSaliencyBox(dataUrl), 400);
  if (sal) return { box: sal, naturalW: W, naturalH: H };

  // Tidak ditemukan → null
  return null;
}

/* ===== Tips Integrasi performa (sudah dipakai di atas):
   - Semua import berat: zxing, tfjs, coco-ssd, tesseract → diimport di dalam fungsi (lazy).
   - Reuse worker/model (variabel global module).
   - Downscale gambar sebelum dianalisis (900–768px) untuk mempercepat.
   - withTimeout() membatasi durasi tiap tahap agar UI tetap cepat.
*/
