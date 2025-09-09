// lib/imageUtils.ts
// Utility client-side: bikin thumbnail dan konversi blob <-> dataURL

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/**
 * Resize gambar ke maxWidth (height menyesuaikan) → output JPEG Blob.
 * @param srcBlob   Blob asli (JPEG/PNG/HEIC yang sudah dibaca <input>)
 * @param maxWidth  lebar maksimum thumbnail (default 640 px)
 * @param contain   true = fit/contain, false = cover (default true)
 * @param quality   kualitas JPEG 0..1 (default 0.8)
 */
export async function makeThumbnail(
  srcBlob: Blob,
  maxWidth = 640,
  contain = true,
  quality = 0.8
): Promise<Blob> {
  // Pakai createImageBitmap kalau ada (lebih cepat)
  const imgBitmap = await createImageBitmap(srcBlob).catch(async () => {
    // fallback pakai <img>
    const url = URL.createObjectURL(srcBlob);
    const imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    const bitmap = await createImageBitmap(imgEl);
    URL.revokeObjectURL(url);
    return bitmap;
  });

  const { width: iw, height: ih } = imgBitmap;
  if (iw <= maxWidth) {
    // kecilkan sedikit saja agar file tetap hemat
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, maxWidth / iw);
    canvas.width = Math.round(iw * scale);
    canvas.height = Math.round(ih * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
        "image/jpeg",
        quality
      )
    );
    imgBitmap.close?.();
    return blob;
  }

  // hitung target size
  let tw = maxWidth;
  let th = Math.round((ih / iw) * tw);

  // contain vs cover (untuk thumbnail umumnya contain)
  if (!contain) {
    // cover: bikin crop center di sisi pendek
    const aspect = iw / ih;
    const targetAspect = tw / th;
    let sx = 0,
      sy = 0,
      sw = iw,
      sh = ih;
    if (aspect > targetAspect) {
      // terlalu lebar => crop kiri-kanan
      sh = ih;
      sw = Math.round(ih * targetAspect);
      sx = Math.round((iw - sw) / 2);
    } else {
      // terlalu tinggi => crop atas-bawah
      sw = iw;
      sh = Math.round(iw / targetAspect);
      sy = Math.round((ih - sh) / 2);
    }
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgBitmap, sx, sy, sw, sh, 0, 0, tw, th);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
        "image/jpeg",
        quality
      )
    );
    imgBitmap.close?.();
    return blob;
  }

  // contain: skala proporsional
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(imgBitmap, 0, 0, tw, th);
  const out = await new Promise<Blob>((res, rej) =>
    canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
      "image/jpeg",
      quality
    )
  );
  imgBitmap.close?.();
  return out;
}
