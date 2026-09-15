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

const HANZI_CENTER = HANZI_VIEWBOX / 2

/**
 * Content-center of a glyph in Make-Me-a-Hanzi y-up space (bbox of medians).
 * Falls back to viewBox center when medians are empty.
 */
export function contentCenterFromMedians(medians: number[][][]): Point {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const stroke of medians) {
    for (const pt of stroke) {
      if (!pt || pt.length < 2) continue
      const x = pt[0]!
      const y = pt[1]!
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX)) {
    return { x: HANZI_CENTER, y: HANZI_CENTER }
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

/** Offset that maps content center (cx, cy) onto the 1024 viewBox center. */
export function contentCenterOffset(center: Point): Point {
  return { x: HANZI_CENTER - center.x, y: HANZI_CENTER - center.y }
}

/**
 * Translate absolute MMAH SVG path coordinates (M/L/Q/C/Z and relatives).
 * Robust enough for vendored hanzi-writer-data paths.
 */
export function translateSvgPath(path: string, dx: number, dy: number): string {
  if ((dx === 0 && dy === 0) || !path) return path

  const numRe = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
  let out = ''
  let i = 0
  let cmd = ''
  let argIndex = 0

  const argsPerCmd = (c: string): number => {
    switch (c) {
      case 'Z':
      case 'z':
        return 0
      case 'H':
      case 'h':
      case 'V':
      case 'v':
        return 1
      case 'M':
      case 'm':
      case 'L':
      case 'l':
      case 'T':
      case 't':
        return 2
      case 'S':
      case 's':
      case 'Q':
      case 'q':
        return 4
      case 'C':
      case 'c':
        return 6
      case 'A':
      case 'a':
        return 7
      default:
        return 2
    }
  }

  while (i < path.length) {
    const ch = path[i]!
    if (/[A-Za-z]/.test(ch)) {
      cmd = ch
      argIndex = 0
      out += ch
      i++
      continue
    }
    if (ch === ',' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      out += ch
      i++
      continue
    }
    numRe.lastIndex = i
    const m = numRe.exec(path)
    if (!m || m.index !== i) {
      out += ch
      i++
      continue
    }
    const raw = m[0]
    const value = Number(raw)
    i = m.index + raw.length
    const arity = argsPerCmd(cmd)
    let next = value
    if (arity === 0) {
      next = value
    } else if (cmd === 'H') {
      next = value + dx
    } else if (cmd === 'h') {
      next = value // relative
    } else if (cmd === 'V') {
      next = value + dy
    } else if (cmd === 'v') {
      next = value
    } else if (cmd === 'A' || cmd === 'a') {
      const slot = argIndex % 7
      if (cmd === 'A' && (slot === 5 || slot === 6)) {
        next = value + (slot === 5 ? dx : dy)
      } else {
        next = value
      }
    } else {
      const slot = argIndex % arity
      const absolute = cmd === cmd.toUpperCase()
      if (absolute) {
        next = value + (slot % 2 === 0 ? dx : dy)
      }
    }
    // Preserve integer formatting when possible
    if (Number.isInteger(next) && !/[.eE]/.test(raw)) {
      out += String(next)
    } else {
      out += String(next)
    }
    argIndex++
    // After M/m pair, subsequent pairs are implicit L/l
    if ((cmd === 'M' || cmd === 'm') && argIndex === 2) {
      cmd = cmd === 'M' ? 'L' : 'l'
      argIndex = 0
    }
  }
  return out
}

/** Apply content-center offset to strokes + medians (shared with charDataLoader). */
export function offsetCharacterGeometry(
  strokes: string[],
  medians: number[][][],
  offset: Point,
): { strokes: string[]; medians: number[][][] } {
  const { x: dx, y: dy } = offset
  if (dx === 0 && dy === 0) {
    return { strokes, medians }
  }
  return {
    strokes: strokes.map((p) => translateSvgPath(p, dx, dy)),
    medians: medians.map((stroke) =>
      stroke.map((pt) => [pt[0]! + dx, pt[1]! + dy]),
    ),
  }
}

/**
 * Apply hanzi view transform in CSS-pixel space (y-up → canvas y-down).
 * After pad + scale(s,-s), optionally translate(512-cx, 512-cy) so glyph
 * content center maps to viewBox center → mi-zi-ge pad center.
 * Caller must already have setTransform(dpr, 0, 0, dpr, 0, 0) when drawing to a DPR canvas.
 */
export function applyHanziTransform(
  ctx: CanvasRenderingContext2D,
  cssSize: number,
  contentCenter?: Point,
): void {
  const scale = hanziScale(cssSize)
  const cx = contentCenter?.x ?? HANZI_CENTER
  const cy = contentCenter?.y ?? HANZI_CENTER
  ctx.translate(HANZI_PADDING, cssSize - HANZI_PADDING)
  ctx.scale(scale, -scale)
  ctx.translate(HANZI_CENTER - cx, HANZI_CENTER - cy)
}

/** Map one hanzi (1024, y-up) point into CSS pixels (same pad/scale/center as applyHanziTransform). */
export function mapHanziPointToCss(
  x: number,
  y: number,
  cssSize: number,
  contentCenter?: Point,
): Point {
  const scale = hanziScale(cssSize)
  const cx = contentCenter?.x ?? HANZI_CENTER
  const cy = contentCenter?.y ?? HANZI_CENTER
  const hx = x + (HANZI_CENTER - cx)
  const hy = y + (HANZI_CENTER - cy)
  return {
    x: HANZI_PADDING + hx * scale,
    y: cssSize - HANZI_PADDING - hy * scale,
  }
}

/** Skip median segments shorter than this (hanzi 1024 units). */
const TANGENT_EPS = 1e-3

/**
 * Unit tangent of the first non-degenerate median segment (hanzi 1024, y-up).
 * Start of the stroke is median[0]; this walks consecutive points and skips
 * coincident / zero-length samples. Null if the polyline has no real segment.
 */
export function earlyMedianTangent(median: number[][]): Point | null {
  for (let i = 0; i < median.length - 1; i++) {
    const a = median[i]
    const b = median[i + 1]
    if (!a || !b || a.length < 2 || b.length < 2) continue
    const dx = b[0]! - a[0]!
    const dy = b[1]! - a[1]!
    const len = Math.hypot(dx, dy)
    if (len > TANGENT_EPS) {
      return { x: dx / len, y: dy / len }
    }
  }
  return null
}

/**
 * Map hanzi-writer medians (1024, y-up) into device-pixel canvas coords
 * using the same padding/scale/y-flip as stroke-path guides and the letter mask.
 */
export function mapMediansToCanvas(
  medians: number[][][],
  cssSize: number,
  dpr: number,
  contentCenter?: Point,
): Point[][] {
  const center = contentCenter ?? contentCenterFromMedians(medians)
  return medians.map((stroke) =>
    stroke.map((pt) => {
      const css = mapHanziPointToCss(pt[0]!, pt[1]!, cssSize, center)
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
  const contentCenter = contentCenterFromMedians(medians)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssSize, cssSize)
  ctx.fillStyle = '#000'
  ctx.save()
  applyHanziTransform(ctx, cssSize, contentCenter)
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

  const mappedStrokes = mapMediansToCanvas(medians, cssSize, dpr, contentCenter)

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
