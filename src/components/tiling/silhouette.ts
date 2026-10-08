import type { Rect } from '@/domain/tiling'

/**
 * Prévia aproximada da faca pelo contorno, calculada na imagem de tela da arte (baixa
 * resolução). Mesma regra do analisador: o branco ligado à borda é papel, não arte; o resto
 * é contornado e afastado pelo valor pedido. A faca exata é medida na exportação.
 *
 * Devolve um caminho SVG em mm da arte (eixo Y para cima).
 */
export async function artOutline(
  url: string,
  rect: Rect,
  options: { offsetMm: number; whiteIsArt: boolean },
): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('imagem'))
    img.src = url
  })
  const scale = 600 / Math.max(image.naturalWidth, image.naturalHeight)
  const w = Math.max(2, Math.round(image.naturalWidth * scale))
  const h = Math.max(2, Math.round(image.naturalHeight * scale))
  const mmPerPx = rect.w / w
  const pad = Math.min(60, Math.max(0, Math.ceil(options.offsetMm / mmPerPx)) + 1)
  const W = w + 2 * pad
  const H = h + 2 * pad

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return ''
  context.drawImage(image, 0, 0, w, h)
  const pixels = context.getImageData(0, 0, w, h).data

  // 1 = arte. A margem extra (pad) começa vazia, para o afastamento caber.
  let mask = new Uint8Array(W * H)
  const paper = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2], pixels[i * 4 + 3]]
    paper[i] = a < 16 || (!options.whiteIsArt && Math.min(r, g, b) >= 245) ? 1 : 0
  }
  // Papel de verdade = branco/transparente ligado à borda (o branco dentro da arte é arte).
  const background = new Uint8Array(w * h)
  const stack: number[] = []
  const seed = (i: number) => {
    if (paper[i] && !background[i]) {
      background[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x)
    seed((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    seed(y * w)
    seed(y * w + w - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i - x) / w
    if (x > 0) seed(i - 1)
    if (x < w - 1) seed(i + 1)
    if (y > 0) seed(i - w)
    if (y < h - 1) seed(i + w)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) mask[(y + pad) * W + x + pad] = background[y * w + x] ? 0 : 1
  }

  // Afastamento: cresce (para fora) ou encolhe (para dentro) um pixel por passo.
  const grow = options.offsetMm > 0
  const wanted = Math.round(Math.abs(options.offsetMm) / mmPerPx)
  // Para fora, até a margem extra; para dentro, sem esse limite.
  const steps = grow ? Math.min(pad - 1, wanted) : wanted
  for (let s = 0; s < Math.min(steps, 60); s++) {
    const next = new Uint8Array(mask)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x
        if (grow ? mask[i] : !mask[i]) continue
        const around = mask[i - 1] + mask[i + 1] + mask[i - W] + mask[i + W]
        if (grow ? around > 0 : around < 4) next[i] = grow ? 1 : 0
      }
    }
    mask = next
  }

  // Bordas entre arte e papel (quadrados de marching squares, segmentos pelo meio das arestas).
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x])
  const px = (x: number) => rect.x + (x - pad) * mmPerPx
  const py = (y: number) => rect.y + rect.h - (y - pad) * mmPerPx
  const parts: string[] = []
  const segment = (x1: number, y1: number, x2: number, y2: number) =>
    parts.push(`M${px(x1).toFixed(1)} ${py(y1).toFixed(1)}L${px(x2).toFixed(1)} ${py(y2).toFixed(1)}`)
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const tl = at(x, y)
      const tr = at(x + 1, y)
      const br = at(x + 1, y + 1)
      const bl = at(x, y + 1)
      const code = tl * 8 + tr * 4 + br * 2 + bl
      if (code === 0 || code === 15) continue
      // Centros dos pixels em x+0.5; meios das arestas da célula.
      const top: [number, number] = [x + 1, y + 0.5]
      const right: [number, number] = [x + 1.5, y + 1]
      const bottom: [number, number] = [x + 1, y + 1.5]
      const left: [number, number] = [x + 0.5, y + 1]
      const join = (a: [number, number], b: [number, number]) => segment(a[0], a[1], b[0], b[1])
      switch (code) {
        case 1:
        case 14:
          join(left, bottom)
          break
        case 2:
        case 13:
          join(bottom, right)
          break
        case 3:
        case 12:
          join(left, right)
          break
        case 4:
        case 11:
          join(top, right)
          break
        case 5:
          join(left, top)
          join(bottom, right)
          break
        case 6:
        case 9:
          join(top, bottom)
          break
        case 7:
        case 8:
          join(left, top)
          break
        case 10:
          join(top, right)
          join(left, bottom)
          break
      }
    }
  }
  return parts.join('')
}
