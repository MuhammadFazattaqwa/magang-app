// lib/getCroppedImg.ts
export async function getCroppedImg(
  imageSrc: string,
  crop: { x: number; y: number; width: number; height: number },
  rotation = 0,
  flip = { horizontal: false, vertical: false }
): Promise<string> {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

  const safeArea = Math.max(image.width, image.height) * 2
  canvas.width = safeArea
  canvas.height = safeArea

  ctx.translate(safeArea / 2, safeArea / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1)
  ctx.translate(-safeArea / 2, -safeArea / 2)
  ctx.drawImage(image, (safeArea - image.width) / 2, (safeArea - image.height) / 2)

  const data = ctx.getImageData(0, 0, safeArea, safeArea)

  // set canvas ke ukuran crop
  canvas.width = crop.width
  canvas.height = crop.height

  // letakkan area yang dicrop
  ctx.putImageData(
    data,
    Math.round(-safeArea / 2 + image.width / 2 - crop.x),
    Math.round(-safeArea / 2 + image.height / 2 - crop.y)
  )

  return canvas.toDataURL('image/jpeg', 0.9)
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.setAttribute('crossorigin', 'anonymous')
    image.src = url
  })
}
