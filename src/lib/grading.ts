/** TracePad three-gate grading (ported for Chinese). */

export const COVER_THRESHOLD = 0.5
/** Fallback ink width (CSS px). Prefer inkWidthCss() for draw + stamp. */
export const INK_WIDTH = 18
export const GRID_COLS = 3
export const GRID_ROWS = 3
export const CELL_MIN_SHARE = 0.04
export const CELL_COVER = 0.32
export const STROKE_COVER = 0.4

/** Hanzi-writer / Make-Me-a-Hanzi viewBox size. */
export const HANZI_VIEWBOX = 1024
/** Padding around the 1024 viewBox — must match HanziWriter.create({ padding }). */
export const HANZI_PADDING = 28

/**
 * Responsive ink width in CSS px for TracePad stroke + grading stamp.
 * ≈ clamp(16px, 4vw, 22px) — ~18 on phones, up to ~22 on larger screens.
 */
export function inkWidthCss(): number {
  if (typeof window === 'undefined') return INK_WIDTH
  const vwBased = window.innerWidth * 0.04
  return Math.round(Math.min(22, Math.max(16, vwBased)))
}

/** Handwriting font for UI titles only (not TracePad mask/guide). */
export const HANDWRITING_FONT = 'Ma Shan Zheng'

export type GlyphBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export type Point = { x: number; y: number }

export type LetterMask = {
  width: number
  height: number
  dpr: number
  letterBits: Uint8Array
  inkBits: Uint8Array
  letterCount: number
  glyphBox: GlyphBox
  cellLetter: number[]
  cellInk: number[]
  /** Median polylines mapped into device-pixel canvas space (same as letterBits). */
  mappedStrokes: Point[][]
}

export type GradeStatus = {
  cover: number
  coverReady: boolean
  cellsReady: boolean
  strokesReady: boolean
  pass: boolean
}

/** Live TracePad copy for failing gates (thresholds unchanged). */
export function describeGradeNeeds(status: GradeStatus): string {
  const parts: string[] = []
  if (!status.coverReady) parts.push('cover')
  if (!status.cellsReady) parts.push('regions')
  if (!status.strokesReady) parts.push('finish all strokes (e.g. hooks)')
  if (parts.length === 0) return 'all gates ok'
  return `need ${parts.join(' + ')}`
}

function emptyCells(): number[] {
  return Array.from({ length: GRID_COLS * GRID_ROWS }, () => 0)
}

/** Wait until the handwriting font is usable for UI titles. */
export async function ensureHandwritingFont(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  try {
    await document.fonts.load(`64px "${HANDWRITING_FONT}"`)
    await document.fonts.ready
  } catch {
    // Fall through — browser will use a fallback face.
  }
}

/** Uniform scale from 1024 viewBox into the padded square (CSS px). */
export function hanziScale(cssSize: number): number {
  return (cssSize - 2 * HANZI_PADDING) / HANZI_VIEWBOX
}

/**
 * Apply hanzi-writer view transform in CSS-pixel space (y-up → canvas y-down).
 * Caller must already have setTransform(dpr, 0, 0, dpr, 0, 0) when drawing to a DPR canvas.
 */
export function applyHanziTransform(
  ctx: CanvasRenderingContext2D,
  cssSize: number,
): void {
  const scale = hanziScale(cssSize)
  ctx.translate(HANZI_PADDING, cssSize - HANZI_PADDING)
  ctx.scale(scale, -scale)
}

/** Map one hanzi (1024, y-up) point into CSS pixels. */
export function mapHanziPointToCss(
  x: number,
  y: number,
  cssSize: number,
): Point {
  const scale = hanziScale(cssSize)
  return {
    x: HANZI_PADDING + x * scale,
    y: cssSize - HANZI_PADDING - y * scale,
  }
}

/**
 * Map hanzi-writer medians (1024, y-up) into device-pixel canvas coords
 * using the same padding/scale/y-flip as stroke-path guides and the letter mask.
 */
export function mapMediansToCanvas(
  medians: number[][][],
  cssSize: number,
  dpr: number,
): Point[][] {
  return medians.map((stroke) =>
    stroke.map((pt) => {
      const css = mapHanziPointToCss(pt[0]!, pt[1]!, cssSize)
      return { x: css.x * dpr, y: css.y * dpr }
    }),
  )
}

/**
 * Build glyph mask by rasterizing Make-Me-a-Hanzi stroke Path2D fills
 * (same transform as TracePad guides / hanzi-writer). No fillText.
 * letterBits = alpha > 24; GlyphBox from those pixels; 3×3 cellLetter counts.
 */
export function buildLetterMask(
  strokePaths: string[],
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  medians: number[][][],
): LetterMask {
  const cssSize = Math.max(1, Math.min(cssWidth, cssHeight))
  const width = Math.max(1, Math.round(cssSize * dpr))
  const height = Math.max(1, Math.round(cssSize * dpr))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssSize, cssSize)
  ctx.fillStyle = '#000'
  ctx.save()
  applyHanziTransform(ctx, cssSize)
  for (const strokePath of strokePaths) {
    try {
      ctx.fill(new Path2D(strokePath))
    } catch {
      // Ignore malformed path segments.
    }
  }
  ctx.restore()

  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const letterBits = new Uint8Array(width * height)
  const inkBits = new Uint8Array(width * height)
  let letterCount = 0
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0

  for (let i = 0; i < letterBits.length; i++) {
    if (data[i * 4 + 3]! > 24) {
      letterBits[i] = 1
      letterCount++
      const x = i % width
      const y = (i / width) | 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (letterCount === 0) {
    minX = 0
    minY = 0
    maxX = width - 1
    maxY = height - 1
  }

  const glyphBox: GlyphBox = {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
  }

  const cellLetter = emptyCells()
  for (let i = 0; i < letterBits.length; i++) {
    if (!letterBits[i]) continue
    const x = i % width
    const y = (i / width) | 0
    const col = Math.min(
      GRID_COLS - 1,
      Math.max(0, Math.floor(((x - glyphBox.minX) / glyphBox.width) * GRID_COLS)),
    )
    const row = Math.min(
      GRID_ROWS - 1,
      Math.max(0, Math.floor(((y - glyphBox.minY) / glyphBox.height) * GRID_ROWS)),
    )
    cellLetter[row * GRID_COLS + col]!++
  }

  const mappedStrokes = mapMediansToCanvas(medians, cssSize, dpr)

  return {
    width,
    height,
    dpr,
    letterBits,
    inkBits,
    letterCount,
    glyphBox,
    cellLetter,
    cellInk: emptyCells(),
    mappedStrokes,
  }
}

function cellIndexForPixel(mask: LetterMask, x: number, y: number): number {
  const { glyphBox } = mask
  const col = Math.min(
    GRID_COLS - 1,
    Math.max(0, Math.floor(((x - glyphBox.minX) / glyphBox.width) * GRID_COLS)),
  )
  const row = Math.min(
    GRID_ROWS - 1,
    Math.max(0, Math.floor(((y - glyphBox.minY) / glyphBox.height) * GRID_ROWS)),
  )
  return row * GRID_COLS + col
}

/**
 * Stamp ink into inkBits only on letter pixels (outside-letter ink never counted).
 * Coordinates are CSS pixels; converted with dpr.
 */
export function stampInk(
  mask: LetterMask,
  cssX: number,
  cssY: number,
  radiusCss = inkWidthCss() / 2,
): void {
  const { width, height, dpr, letterBits, inkBits, cellLetter, cellInk } = mask
  const cx = cssX * dpr
  const cy = cssY * dpr
  const rad = radiusCss * dpr
  const rad2 = rad * rad
  const x0 = Math.max(0, Math.floor(cx - rad))
  const y0 = Math.max(0, Math.floor(cy - rad))
  const x1 = Math.min(width - 1, Math.ceil(cx + rad))
  const y1 = Math.min(height - 1, Math.ceil(cy + rad))

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy > rad2) continue
      const i = y * width + x
      if (!letterBits[i] || inkBits[i]) continue
      inkBits[i] = 1
      const ci = cellIndexForPixel(mask, x, y)
      // Only cells that have letter mass matter; still track all for simplicity.
      if (cellLetter[ci]! > 0) cellInk[ci]!++
    }
  }
}

/** Stamp along a segment between two CSS points (dense enough for INK_WIDTH). */
export function stampInkSegment(
  mask: LetterMask,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const dist = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.max(1, Math.ceil(dist / 2))
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    stampInk(mask, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
  }
}

export function clearInk(mask: LetterMask): void {
  mask.inkBits.fill(0)
  mask.cellInk.fill(0)
}

function inkNear(
  mask: LetterMask,
  px: number,
  py: number,
  rad: number,
): boolean {
  const { width, height, inkBits } = mask
  const x0 = Math.max(0, Math.floor(px - rad))
  const y0 = Math.max(0, Math.floor(py - rad))
  const x1 = Math.min(width - 1, Math.ceil(px + rad))
  const y1 = Math.min(height - 1, Math.ceil(py + rad))
  const rad2 = rad * rad
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - px
      const dy = y + 0.5 - py
      if (dx * dx + dy * dy > rad2) continue
      if (inkBits[y * width + x]) return true
    }
  }
  return false
}

/** Sample polyline at t = 0.12 .. 0.92 step 0.08 (arc-length parameter). */
export function sampleStroke(points: Point[]): Point[] {
  if (points.length === 0) return []
  if (points.length === 1) return [points[0]!]

  const segLens: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(
      points[i]!.x - points[i - 1]!.x,
      points[i]!.y - points[i - 1]!.y,
    )
    segLens.push(len)
    total += len
  }
  if (total < 1e-6) return [points[0]!]

  const samples: Point[] = []
  for (let t = 0.12; t <= 0.92 + 1e-9; t += 0.08) {
    const target = t * total
    let acc = 0
    let placed = false
    for (let i = 0; i < segLens.length; i++) {
      const len = segLens[i]!
      if (acc + len >= target || i === segLens.length - 1) {
        const local = len < 1e-9 ? 0 : (target - acc) / len
        const a = points[i]!
        const b = points[i + 1]!
        samples.push({
          x: a.x + (b.x - a.x) * local,
          y: a.y + (b.y - a.y) * local,
        })
        placed = true
        break
      }
      acc += len
    }
    if (!placed) samples.push(points[points.length - 1]!)
  }
  return samples
}

export function evaluateGrade(mask: LetterMask): GradeStatus {
  const inked = mask.inkBits.reduce((n, v) => n + v, 0)
  const cover = mask.letterCount > 0 ? inked / mask.letterCount : 0
  const coverReady = cover >= COVER_THRESHOLD

  let cellsReady = true
  for (let c = 0; c < mask.cellLetter.length; c++) {
    const letter = mask.cellLetter[c]!
    if (letter / Math.max(1, mask.letterCount) < CELL_MIN_SHARE) continue
    const ratio = letter > 0 ? mask.cellInk[c]! / letter : 0
    if (ratio < CELL_COVER) {
      cellsReady = false
      break
    }
  }

  const rad = Math.max(6, Math.round((inkWidthCss() / 2.4) * mask.dpr))
  let strokesReady = true
  for (const stroke of mask.mappedStrokes) {
    const samples = sampleStroke(stroke)
    if (samples.length === 0) continue
    let hits = 0
    for (const p of samples) {
      if (inkNear(mask, p.x, p.y, rad)) hits++
    }
    if (hits / samples.length < STROKE_COVER) {
      strokesReady = false
      break
    }
  }

  return {
    cover,
    coverReady,
    cellsReady,
    strokesReady,
    pass: coverReady && cellsReady && strokesReady,
  }
}
