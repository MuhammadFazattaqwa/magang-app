/* eslint-disable @typescript-eslint/ban-ts-comment */
import Tesseract from "tesseract.js"

export type OCRPhase = "idle" | "barcode" | "ocr" | "done" | "error"
export interface OcrInfo { status: OCRPhase; progress: number; error?: string }
export type OcrProgress = (info: OcrInfo) => void

/* ================= Normalisasi & seleksi ================= */

export function normalizeSN(val: string) {
  let out = (val || "").trim().toUpperCase()

  // potong di pemisah umum (revisi/suffix)
  out = out.split(/[\/\\\s]/)[0] || out

  out = out.replace(/\s+/g, "")
  out = out
    .replace(/Q(?=\d)/g, "0")
    .replace(/(?<=\d)O(?=\d)/g, "0")
    .replace(/O(?=\d)/g, "0")
    .replace(/(?<=\d)[IL](?=\d)/g, "1")
    .replace(/(?<=\d)B(?=\d)/g, "8")
    .replace(/(?<=\d)S(?=\d)/g, "5")

  return out.replace(/[^A-Z0-9\-]/g, "")
}

const COMMON_WORD = /^(MODEL|HIKVISION|DAHUA|NETWORK|CAMERA|SERIES|SKYHAWK|BULLET|ULTRA|SMART|ANPR|MP|CE|FCC)$/i

function scoreCandidate(raw: string, nearLabel = false) {
  const s = normalizeSN(raw)
  if (!s) return -1
  if (COMMON_WORD.test(s)) return -1

  // hindari EAN/UPC all digits 12–14
  if (/^\d{12,14}$/.test(s)) return -2

  let score = 0
  const L = s.length
  if (L >= 8 && L <= 20) score += 6
  else if (L >= 6) score += 3

  if (/[A-Z]/.test(s) && /\d/.test(s)) score += 6
  else if (/\d/.test(s)) score += 2

  if (nearLabel) score += 6
  return score
}

function selectBestSN(raw: string): string | null {
  const left = raw.split("/")[0]
  const alnum = normalizeSN(left).replace(/[^A-Z0-9\-]/g, "")

  // jika 9+ dan kombinasi huruf+angka → ok
  if (alnum.length >= 9 && /[A-Z]/.test(alnum) && /\d/.test(alnum)) return alnum
  // m8: minimal 8 kar. kombinasi
  const m8 = alnum.match(/(?=[A-Z0-9\-]*[A-Z])(?=[A-Z0-9\-]*\d)[A-Z0-9\-]{8,}/)
  if (m8) return m8[0]
  // pure digit panjang (12+) — biasanya barcode, tapi masih kita ijinkan kalau ini yang tersisa
  if (/^\d{12,}$/.test(alnum)) return alnum
  return alnum.length >= 8 ? alnum.slice(0, 8) : null
}

/* ================= Ekstraksi dari hasil OCR ================= */

function extractSN(ocrText: string, words?: Array<{ text: string }>, lines?: Array<{ text: string }>) {
  const labelRe = /\b(?:S\/?N|SERIAL(?:\s*NO\.?|(?:\s*NUMBER)?))\b/i
  const candidates: Array<{ tok: string; near: boolean }> = []

  // 1) Prioritas: baris yang mengandung label + baris berikutnya
  const linesArr = (ocrText || "").replace(/\r/g, "").split("\n")
  for (let i = 0; i < linesArr.length; i++) {
    const L = linesArr[i].trim()
    if (labelRe.test(L)) {
      const right = L.replace(labelRe, "")
      const m = right.match(/[A-Z0-9\-\/]{4,}/i)
      if (m) candidates.push({ tok: m[0], near: true })
      const next = (linesArr[i + 1] || "").trim()
      const m2 = next.match(/^[\s:]*([A-Z0-9\-\/]{4,})/i)
      if (m2) candidates.push({ tok: m2[1], near: true })
    }
  }

  // 2) Token setelah kata “SN” pada level words (tambahan)
  if (words?.length) {
    for (let i = 0; i < words.length; i++) {
      if (labelRe.test(words[i].text)) {
        const tok = [(words[i + 1]?.text ?? ""), (words[i + 2]?.text ?? "")].join(" ")
        const sn = selectBestSN(tok)
        if (sn) candidates.push({ tok: sn, near: true })
      }
    }
  }

  // 3) Fallback: token panjang global (hindari kata umum)
  const T = (ocrText || "").toUpperCase()
  const glob = T.match(/[A-Z0-9][A-Z0-9\-\/]{6,}/g) || []
  for (const g of glob) {
    if (!COMMON_WORD.test(g)) candidates.push({ tok: g, near: false })
  }

  // 4) Skor & pilih
  let best = ""
  let bestScore = -1
  for (const c of candidates) {
    const sc = scoreCandidate(c.tok, c.near)
    if (sc > bestScore) { bestScore = sc; best = c.tok }
  }
  if (!best) return ""

  const final = selectBestSN(best)
  return final ?? ""
}

/* ================= Gambar utils ================= */

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.readAsDataURL(blob)
  })
}

async function scaleUpDataUrl(dataUrl: string, factor = 2.5): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = Math.round(img.naturalWidth * factor)
      c.height = Math.round(img.naturalHeight * factor)
      const ctx = c.getContext("2d")!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL("image/png"))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

async function rotateDataUrl(dataUrl: string, deg: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const rad = (deg * Math.PI) / 180
      const w = img.naturalWidth
      const h = img.naturalHeight
      const c = document.createElement("canvas")
      const ctx = c.getContext("2d")!
      if (deg % 180 === 0) { c.width = w; c.height = h } else { c.width = h; c.height = w }
      ctx.translate(c.width / 2, c.height / 2)
      ctx.rotate(rad)
      ctx.drawImage(img, -w / 2, -h / 2)
      resolve(c.toDataURL("image/png"))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/* ================= Barcode (fallback) ================= */

async function tryDecodeBarcodeFromDataUrl(dataUrl: string): Promise<string | null> {
  try {
    if (typeof window === "undefined") return null
    const { BrowserMultiFormatReader } = await import("@zxing/browser")
    const imgEl = new Image()
    imgEl.src = dataUrl
    await new Promise<void>((res, rej) => { imgEl.onload = () => res(); imgEl.onerror = () => rej(new Error("img load")) })
    // @ts-ignore
    const result = await new BrowserMultiFormatReader().decodeFromImageElement(imgEl as HTMLImageElement)
    const txt = (result as any)?.getText?.() ?? ""
    const norm = normalizeSN(txt)

    // ⛔️ Abaikan EAN/UPC 12–14 digit (biasanya barcode produk, bukan SN)
    if (/^\d{12,14}$/.test(norm)) return null

    return selectBestSN(norm)
  } catch { return null }
}

/* ================= PUBLIC API ================= */

export async function recognizeSerialNumber(
  imageSource: Blob | string,
  opts?: { onProgress?: OcrProgress; enableBarcode?: boolean; mode?: "fast" | "deep" }
): Promise<string | null> {
  const onProgress = opts?.onProgress
  const enableBarcode = opts?.enableBarcode ?? true
  const mode = opts?.mode ?? "deep"
  try {
    onProgress?.({ status: "barcode", progress: 0 })
    const dataUrl = typeof imageSource === "string" ? imageSource : await blobToDataUrl(imageSource)

    // 1) Barcode dulu (tetap cepat), tapi sekarang EAN/UPC akan diabaikan
    if (enableBarcode) {
      const bc = await tryDecodeBarcodeFromDataUrl(dataUrl)
      if (bc) { onProgress?.({ status: "done", progress: 100 }); return bc }
    }

    // 2) OCR
    const scaled = await scaleUpDataUrl(dataUrl, 2.5)
    const anglesFast = [0] as const
    const anglesDeep = [90, 180, 270] as const
    const psmsFast = [6] as const
    const psmsDeep = [7] as const

    onProgress?.({ status: "ocr", progress: 10 })

    const tryPSM = async (psm: 6 | 7, angs: readonly number[]) => {
      for (const ang of angs) {
        const du = ang === 0 ? scaled : await rotateDataUrl(scaled, ang)
        // @ts-ignore
        const result = await Tesseract.recognize(du, "eng", {
          // @ts-ignore
          logger: (m) => m?.status === "recognizing text" && m?.progress != null &&
            onProgress?.({ status: "ocr", progress: Math.min(99, Math.round(10 + m.progress * 80)) }),
          // @ts-ignore
          tessedit_pageseg_mode: String(psm),
          preserve_interword_spaces: "1",
        })
        const text = (result.data?.text ?? "").trim()
        // @ts-ignore
        const words = (result.data?.words ?? []) as Array<{ text: string }>
        // @ts-ignore
        const lines = (result.data?.lines ?? []) as Array<{ text: string }>
        const sn = extractSN(text, words, lines)
        if (sn && sn.length >= 6) return sn
      }
      return null
    }

    // FAST path
    const fast = await tryPSM(6, anglesFast)
    if (fast) { onProgress?.({ status: "done", progress: 100 }); return fast }
    if (mode === "fast") { onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." }); return null }

    // DEEP path
    const deep1 = await tryPSM(7, anglesFast)
    if (deep1) { onProgress?.({ status: "done", progress: 100 }); return deep1 }
    const deep2 = await tryPSM(6, anglesDeep)
    if (deep2) { onProgress?.({ status: "done", progress: 100 }); return deep2 }

    onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." })
    return null
  } catch (e: any) {
    onProgress?.({ status: "error", progress: 0, error: e?.message || "Gagal memproses OCR." })
    return null
  }
}
