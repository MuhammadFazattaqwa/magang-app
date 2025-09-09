/* eslint-disable @typescript-eslint/ban-ts-comment */
import Tesseract from "tesseract.js"

/* ===== Types untuk progress OCR di UI ===== */
export type OCRPhase = "idle" | "barcode" | "ocr" | "done" | "error"
export interface OcrInfo { status: OCRPhase; progress: number; error?: string }
export type OcrProgress = (info: OcrInfo) => void

/* ===== Util kecil ===== */
export function normalizeSN(val: string) {
  let out = (val || "").trim().toUpperCase().replace(/\s+/g, "")
  out = out.replace(/Q(?=\d)/g, "0").replace(/(?<=\d)O(?=\d)/g, "0").replace(/O(?=\d)/g, "0")
  out = out.replace(/(?<=\d)[IL](?=\d)/g, "1").replace(/(?<=\d)B(?=\d)/g, "8").replace(/(?<=\d)S(?=\d)/g, "5")
  return out.replace(/[^\w\-\/]/g, "")
}

function selectBestSN(raw: string): string | null {
  const left = raw.split("/")[0]                 // buang revisi setelah slash
  const alnum = normalizeSN(left).replace(/[^A-Z0-9]/g, "")

  if (raw.includes("/") && alnum.length >= 9) return alnum
  if (/^\d{12,}$/.test(alnum)) return alnum

  const m8 = alnum.match(/(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{8}/)
  if (m8) return m8[0]

  if (alnum.length >= 9 && alnum.length <= 20 && /[A-Z]/.test(alnum) && /\d/.test(alnum)) return alnum
  return alnum.length >= 8 ? alnum.slice(0, 8) : null
}

function extractSN(ocrText: string, words?: Array<{ text: string }>, lines?: Array<{ text: string }>) {
  const labelRe = /\b(?:S\/?N|SERIAL(?:\s*NO\.?|(?:\s*NUMBER)?))\b/i

  // Per-baris
  for (const L of (lines || [])) {
    if (labelRe.test(L.text)) {
      const sn = selectBestSN((L.text.split(labelRe)[1] ?? ""))
      if (sn) return sn
    }
  }

  // Token setelah "SN"
  if (words?.length) {
    for (let i = 0; i < words.length; i++) {
      if (labelRe.test(words[i].text)) {
        const sn = selectBestSN([(words[i + 1]?.text ?? ""), (words[i + 2]?.text ?? "")].join(" "))
        if (sn) return sn
      }
    }
  }

  // Global pattern
  const T = (ocrText || "").toUpperCase()
  const mg = T.match(new RegExp(labelRe.source + String.raw`\s*[:#-]?\s*([A-Z0-9\s\-\/]{5,})`, "i"))
  if (mg?.[1]) {
    const sn = selectBestSN(mg[1])
    if (sn) return sn
  }

  // Long run setelah label di baris
  const line = (T.split(/\r?\n/).find((l) => labelRe.test(l)) || "").replace(labelRe, "")
  const loose = line.match(/[A-Z0-9\-\/]{6,}/i)
  if (loose?.[0]) {
    const sn = selectBestSN(loose[0])
    if (sn) return sn
  }

  // Fallback: deretan digit panjang
  const digits = T.match(/\b\d{8,}\b/)
  if (digits?.[0]) {
    const sn = selectBestSN(digits[0])
    if (sn) return sn
  }

  return ""
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.readAsDataURL(blob)
  })
}

async function scaleUpDataUrl(dataUrl: string, factor = 3): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = img.naturalWidth * factor
      c.height = img.naturalHeight * factor
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
    return selectBestSN(txt)
  } catch { return null }
}

/* ====== PUBLIC API: OCR Serial Number ====== */
export async function recognizeSerialNumber(
  imageSource: Blob | string,
  opts?: { onProgress?: OcrProgress; enableBarcode?: boolean }
): Promise<string | null> {
  const onProgress = opts?.onProgress
  const enableBarcode = opts?.enableBarcode ?? true
  try {
    onProgress?.({ status: "barcode", progress: 0 })
    const dataUrl = typeof imageSource === "string" ? imageSource : await blobToDataUrl(imageSource)

    // 1) Barcode
    if (enableBarcode) {
      const bc = await tryDecodeBarcodeFromDataUrl(dataUrl)
      if (bc) { onProgress?.({ status: "done", progress: 100 }); return bc }
    }

    // 2) OCR (rotate + upscale + PSM)
    const scaled = await scaleUpDataUrl(dataUrl, 3)
    const angles = [0, 90, 180, 270] as const
    const psms = [6, 7] as const
    onProgress?.({ status: "ocr", progress: 10 })

    for (const psm of psms) {
      for (const ang of angles) {
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
        if (sn && sn.length >= 8) { onProgress?.({ status: "done", progress: 100 }); return sn }
      }
    }

    onProgress?.({ status: "error", progress: 0, error: "SN tidak terdeteksi." })
    return null
  } catch (e: any) {
    onProgress?.({ status: "error", progress: 0, error: e?.message || "Gagal memproses OCR." })
    return null
  }
}
