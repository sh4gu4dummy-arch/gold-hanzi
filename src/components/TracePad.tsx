import HanziWriter from 'hanzi-writer'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  STROKE_DATA,
  charDataLoader,
  ensureCharacterStrokes,
  getStrokeData,
} from '../data/strokeData'
import type { StrokeCharacterData } from '../data/strokeData'
import {
  HANZI_PADDING,
  activeStrokeIndex,
  applyHanziTransform,
  buildLetterMask,
  buildStrokeKeepBits,
  clearInk,
  contentCenterFromMedians,
  countSetBits,
  earlyMedianTangent,
  evaluateGrade,
  hanziScale,
  inkWidthCss,
  outOfOrderRequiredStroke,
  paintCapExceeded,
  stampInkSegment,
  stampPaintBitsSegment,
} from '../lib/grading'
import type { GradeStatus, LetterMask } from '../lib/grading'
import {
  getCharProgress,
  getLevelInk,
  isLevelBeaten,
  isLevelUnlocked,
  markLevelBeaten,
} from '../lib/progress'
import type { CharProgress } from '../lib/progress'
import { getDemoEnabled, setDemoEnabled } from '../lib/demoPref'
import {
  getAutoNextLevel,
  setAutoNextLevel,
} from '../lib/autoNextPref'
import { getSoundEnabled, setSoundEnabled } from '../lib/soundPref'
import { cancelSpeech, speakHanzi } from '../lib/speak'
import type { SpeakResult } from '../lib/speak'

export const DEFAULT_ACCENT = '#7C5CBF'
/** Guide path fill when a stroke passes median grading (hit fraction + end band). */
export const DONE_STROKE_GREEN = '#22A06B'

/** ~2× slower than hanzi-writer defaults (speed 1). */
const GUIDE_ANIM_SPEED = 0.45
const GUIDE_HIGHLIGHT_SPEED = 0.5
const AUTO_ADVANCE_MS = 1000
/** Slightly longer hold on last-level clear so char-celebrate can read before next char. */
const CHAR_CLEAR_AUTO_ADVANCE_MS = 1200
const CHAR_CELEBRATE_FADE_MS = 200
const CHAR_CELEBRATE_AUTO_DISMISS_MS = 2000

type CelebrateDot = {
  id: number
  dx: string
  dy: string
  color: string
  size: number
  delay: number
  duration: number
}

type CharCelebrate = {
  dots: CelebrateDot[]
  fading: boolean
}

const CELEBRATE_COLORS = ['#22a06b', '#3dcf8e', '#a78bfa', '#c4b5fd', '#9b7fd4']

function makeCelebrateDots(): CelebrateDot[] {
  const n = 12 + Math.floor(Math.random() * 7) // 12–18
  const dots: CelebrateDot[] = []
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.45
    const dist = 22 + Math.random() * 38 // % of pad
    dots.push({
      id: i,
      dx: `${(Math.cos(angle) * dist).toFixed(1)}%`,
      dy: `${(Math.sin(angle) * dist).toFixed(1)}%`,
      color: CELEBRATE_COLORS[i % CELEBRATE_COLORS.length]!,
      size: 4 + Math.random() * 4,
      delay: Math.random() * 50,
      duration: 400 + Math.random() * 100,
    })
  }
  return dots
}


type TracePadProps = {
  character: string
  accent?: string
  onDone?: () => void
  onProgressChange?: (progress: CharProgress, levelCount: number) => void
  /** Fires when the active practice level or its cleared state changes. */
  onActiveLevelChange?: (level: number, levelCleared: boolean) => void
  /**
   * Optional host element (Practice: above large pinyin / grid).
   * When set, Demo/Replay + level-pip strip are portaled there.
   */
  levelPipsHost?: HTMLElement | null
  /**
   * Optional CTA for the post-clear bar right half when no more levels
   * remain and Auto next is off (e.g. Next character / All caught up).
   */
  nextCharAction?: ReactNode
  /**
   * When Auto next is on and the last level clears, called after the same
   * delay as level auto-advance (Practice: navigate to next character).
   */
  onAutoNextCharacter?: () => void
}

type Phase = 'loading' | 'demo' | 'writing' | 'passed'

/** Post–pen-up snapshot so Undo can restore ink store + grading mask. */
type InkSnapshot = {
  storePixels: ImageData | null
  inkBits: Uint8Array
  cellInk: number[]
  strokeDone: boolean[] | null
}

function lighten(hex: string, amount: number): string {
  const raw = hex.replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const num = Number.parseInt(full, 16)
  if (Number.isNaN(num)) return hex
  const r = Math.min(255, ((num >> 16) & 0xff) + amount)
  const g = Math.min(255, ((num >> 8) & 0xff) + amount)
  const b = Math.min(255, (num & 0xff) + amount)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const num = Number.parseInt(full, 16)
  if (Number.isNaN(num)) return `rgba(124, 92, 191, ${alpha})`
  const r = (num >> 16) & 0xff
  const g = (num >> 8) & 0xff
  const b = num & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * CSS-px marker size mapped into hanzi space (10–14px, readable on phones).
 * Under applyHanziTransform, 1 hanzi unit = hanziScale(cssSize) CSS px.
 */
function markerSizeHanzi(cssSize: number): { u: number; scale: number } {
  const scale = Math.max(hanziScale(cssSize), 1e-9)
  const cssPx = Math.min(14, Math.max(10, Math.round(cssSize * 0.038)))
  return { u: cssPx / scale, scale }
}

/**
 * Direction arrow along the early median tangent (hanzi y-up).
 * Origin sits a short way into the stroke from the (possibly fanned)
 * start; the tip is further along the same unit tangent. Collision
 * offsets may move the whole mark, but (tx, ty) is never rotated.
 * Filled chevron + short shaft so it reads as "draw this way" on phones.
 */
function drawGuideArrow(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  tx: number,
  ty: number,
  u: number,
  scale: number,
  color: string,
): void {
  // Visual size ≈ marker css px (10–14): ~22px long, ~12px-wide head.
  const inset = u * 0.4
  const len = u * 1.85
  const headLen = u * 0.86
  const headHalf = u * 0.5
  const shaftHalf = u * 0.155

  const ax = ox + tx * inset
  const ay = oy + ty * inset
  const tipx = ax + tx * len
  const tipy = ay + ty * len
  const bx = -ty
  const by = tx
  const neck = Math.max(len - headLen, len * 0.28)
  const nx = ax + tx * neck
  const ny = ay + ty * neck

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(ax + bx * shaftHalf, ay + by * shaftHalf)
  ctx.lineTo(nx + bx * shaftHalf, ny + by * shaftHalf)
  ctx.lineTo(nx + bx * headHalf, ny + by * headHalf)
  ctx.lineTo(tipx, tipy)
  ctx.lineTo(nx - bx * headHalf, ny - by * headHalf)
  ctx.lineTo(nx - bx * shaftHalf, ny - by * shaftHalf)
  ctx.lineTo(ax - bx * shaftHalf, ay - by * shaftHalf)
  ctx.closePath()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = color
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)'
  ctx.lineWidth = Math.max(2 / scale, u * 0.09)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** Nominal circled-number center: back along tangent + left (y-up). */
function nominalNumberCenter(
  ox: number,
  oy: number,
  tx: number,
  ty: number,
  u: number,
): { x: number; y: number } {
  const px = -ty
  const py = tx
  return {
    x: ox - tx * (u * 0.52) + px * (u * 0.78),
    y: oy - ty * (u * 0.52) + py * (u * 0.78),
  }
}

type GuideMarker = {
  /** True 0-based stroke index (number shown is index+1). */
  strokeIndex: number
  ox: number
  oy: number
  tx: number
  ty: number
  hasTangent: boolean
  /** Marker size in hanzi units (may shrink when clustered). */
  u: number
  /** Extra offset applied to arrow origin + number disc (hanzi). */
  offx: number
  offy: number
  /** Final number-disc center. */
  nx: number
  ny: number
}

/**
 * Place stroke-order markers so near-duplicate starts do not stack.
 *
 * Strategy (hanzi 1024 units):
 * 1. Union-find clusters where origins are within ~1.55·u OR nominal
 *    disc centers are within 1.15·u (near-overlap).
 * 2. Clustered markers use a slightly smaller disc (0.86·u).
 * 3. Fan cluster members along the average outward normal (left of
 *    tangent), with a small extra outward nudge so discs clear the
 *    stroke body no worse than the unclustered layout.
 * 4. A few pairwise separation passes finish any residual overlaps.
 * True stroke indices are preserved; only draw offsets change.
 */
function layoutGuideMarkers(
  medians: number[][][],
  fromStroke: number,
  uBase: number,
): GuideMarker[] {
  const items: Omit<GuideMarker, 'u' | 'offx' | 'offy' | 'nx' | 'ny'>[] = []
  for (let i = fromStroke; i < medians.length; i++) {
    const median = medians[i]
    if (!median || median.length === 0) continue
    const origin = median[0]
    if (!origin || origin.length < 2) continue
    const tangent = earlyMedianTangent(median)
    items.push({
      strokeIndex: i,
      ox: origin[0]!,
      oy: origin[1]!,
      tx: tangent?.x ?? 1,
      ty: tangent?.y ?? 0,
      hasTangent: tangent != null,
    })
  }

  const n = items.length
  const markers: GuideMarker[] = items.map((it) => {
    const c = nominalNumberCenter(it.ox, it.oy, it.tx, it.ty, uBase)
    return {
      ...it,
      u: uBase,
      offx: 0,
      offy: 0,
      nx: c.x,
      ny: c.y,
    }
  })
  if (n === 0) return markers

  const startNear = Math.max(72, uBase * 1.55)
  const parent = Array.from({ length: n }, (_, k) => k)
  const find = (a: number): number => {
    let x = a
    while (parent[x] !== x) x = parent[x]!
    let y = a
    while (y !== x) {
      const p = parent[y]!
      parent[y] = x
      y = p
    }
    return x
  }
  const unite = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const A = markers[a]!
      const B = markers[b]!
      const originDist = Math.hypot(A.ox - B.ox, A.oy - B.oy)
      const discDist = Math.hypot(A.nx - B.nx, A.ny - B.ny)
      if (originDist < startNear || discDist < uBase * 1.15) unite(a, b)
    }
  }

  const groups = new Map<number, number[]>()
  for (let k = 0; k < n; k++) {
    const root = find(k)
    const list = groups.get(root)
    if (list) list.push(k)
    else groups.set(root, [k])
  }

  for (const members of groups.values()) {
    const clustered = members.length > 1
    const u = clustered ? uBase * 0.86 : uBase
    for (const k of members) {
      const m = markers[k]!
      m.u = u
      const c = nominalNumberCenter(m.ox, m.oy, m.tx, m.ty, u)
      m.nx = c.x
      m.ny = c.y
      m.offx = 0
      m.offy = 0
    }
    if (!clustered) continue

    members.sort(
      (a, b) => markers[a]!.strokeIndex - markers[b]!.strokeIndex,
    )
    let px = 0
    let py = 0
    for (const k of members) {
      px += -markers[k]!.ty
      py += markers[k]!.tx
    }
    let plen = Math.hypot(px, py)
    if (plen < 1e-6) {
      px = 0
      py = 1
      plen = 1
    } else {
      px /= plen
      py /= plen
    }
    // Side-by-side fan axis ⊥ average outward normal.
    const ax = -py
    const ay = px
    const step = u * 1.2
    const mid = (members.length - 1) / 2
    const outExtra = u * 0.18

    for (let j = 0; j < members.length; j++) {
      const m = markers[members[j]!]!
      const along = (j - mid) * step
      m.offx = ax * along + px * outExtra
      m.offy = ay * along + py * outExtra
      m.nx += m.offx
      m.ny += m.offy
    }

    const minSep = u * 1.15
    for (let iter = 0; iter < 6; iter++) {
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          const A = markers[members[a]!]!
          const B = markers[members[b]!]!
          let dx = B.nx - A.nx
          let dy = B.ny - A.ny
          let dist = Math.hypot(dx, dy)
          if (dist < 1e-6) {
            dx = ax
            dy = ay
            if (A.strokeIndex > B.strokeIndex) {
              dx = -dx
              dy = -dy
            }
            dist = 1
          }
          if (dist >= minSep) continue
          const push = (minSep - dist) / 2
          const ux = dx / dist
          const uy = dy / dist
          A.nx -= ux * push
          A.ny -= uy * push
          A.offx -= ux * push
          A.offy -= uy * push
          B.nx += ux * push
          B.ny += uy * push
          B.offx += ux * push
          B.offy += uy * push
        }
      }
    }
  }

  return markers
}

/** Circled stroke-order index at an explicit disc center. Digit via fillText. */
function drawGuideNumber(
  ctx: CanvasRenderingContext2D,
  nx: number,
  ny: number,
  u: number,
  scale: number,
  n: number,
  fill: string,
  stroke: string,
): void {
  const r = u * 0.5

  ctx.save()
  ctx.beginPath()
  ctx.arc(nx, ny, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.15 / scale
  ctx.stroke()

  // applyHanziTransform y-flips; counter-scale so the digit is upright.
  ctx.translate(nx, ny)
  ctx.scale(1, -1)
  ctx.font = `700 ${u * 0.72}px system-ui, "Noto Sans SC", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.fillText(String(n), 0, 0)
  ctx.restore()
}


/**
 * Median tip + outgoing unit tangent (hanzi y-up).
 * Walks backward from the last sample for a usable segment.
 */
function endMedianPointAndTangent(
  median: number[][],
): { x: number; y: number; tx: number; ty: number } | null {
  if (!median || median.length === 0) return null
  const end = median[median.length - 1]
  if (!end || end.length < 2) return null
  for (let i = median.length - 1; i >= 1; i--) {
    const a = median[i - 1]
    const b = median[i]
    if (!a || !b || a.length < 2 || b.length < 2) continue
    const dx = b[0]! - a[0]!
    const dy = b[1]! - a[1]!
    const len = Math.hypot(dx, dy)
    if (len <= 1e-3) continue
    return { x: end[0]!, y: end[1]!, tx: dx / len, ty: dy / len }
  }
  return { x: end[0]!, y: end[1]!, tx: 1, ty: 0 }
}

/**
 * Very small green check just outside a completed stroke tip.
 * Drawn in hanzi space under applyHanziTransform (counter y-flip).
 */
function drawStrokeDoneCheck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  u: number,
  scale: number,
): void {
  const r = u * 0.36
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(1, -1)
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = hexToRgba(DONE_STROKE_GREEN, 0.95)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.lineWidth = Math.max(1 / scale, u * 0.055)
  ctx.stroke()
  ctx.beginPath()
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1.35 / scale, u * 0.11)
  ctx.moveTo(-r * 0.42, r * 0.04)
  ctx.lineTo(-r * 0.06, r * 0.38)
  ctx.lineTo(r * 0.46, -r * 0.36)
  ctx.stroke()
  ctx.restore()
}

/**
 * Draw stroke-path guides + start-number / direction-arrow markers.
 * Same applyHanziTransform as the grading mask / hanzi-writer (G1).
 * Incomplete underlays follow fromStroke (memory hide). Passed strokes
 * always show a light-green underlay even when memory-hidden. Markers
 * still follow fromStroke; numbers are true stroke index 1…n.
 * Near-duplicate starts are fanned apart (see layoutGuideMarkers).
 */
function drawStrokeGuides(
  ctx: CanvasRenderingContext2D,
  cssSize: number,
  dpr: number,
  strokePaths: string[],
  medians: number[][][],
  fromStroke: number,
  accent: string,
  strokeDone?: boolean[] | null,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssSize, cssSize)
  if (strokePaths.length === 0) return

  const { u, scale } = markerSizeHanzi(cssSize)
  const markerFill = hexToRgba(accent, 0.92)
  const faintFill = hexToRgba(accent, 0.22)
  // Soft underlay — stroke-end checks + char outline carry the “done” cue.
  const doneFill = hexToRgba(DONE_STROKE_GREEN, 0.26)

  const contentCenter = contentCenterFromMedians(medians)

  const activeIdx = activeStrokeIndex(strokeDone, strokePaths.length)

  ctx.save()
  applyHanziTransform(ctx, cssSize, contentCenter)
  // Memory levels hide early incomplete guides, but a passed stroke always
  // reveals its light-green underlay so the player sees confirmation.
  for (let i = 0; i < strokePaths.length; i++) {
    const done = !!strokeDone?.[i]
    const guideVisible = i >= fromStroke
    if (!done && !guideVisible) continue
    try {
      const path = new Path2D(strokePaths[i]!)
      const isActive = !done && i === activeIdx
      ctx.fillStyle = done
        ? doneFill
        : isActive
          ? hexToRgba(accent, 0.34)
          : faintFill
      ctx.fill(path)
    } catch {
      // Ignore malformed path segments.
    }
  }

  // Numbers for incomplete live guides; arrow only on the active stroke.
  const markers = layoutGuideMarkers(medians, fromStroke, u)
  for (const m of markers) {
    const done = !!strokeDone?.[m.strokeIndex]
    if (done) continue
    // Fan may shift the mark; keep the stroke tangent so the arrow
    // still reads as writing direction, not the fan axis.
    const ox = m.ox + m.offx
    const oy = m.oy + m.offy
    const isActive = m.strokeIndex === activeIdx
    const markColor = accent
    const numFill = markerFill
    if (isActive && m.hasTangent) {
      drawGuideArrow(ctx, ox, oy, m.tx, m.ty, m.u, scale, markColor)
    }
    drawGuideNumber(
      ctx,
      m.nx,
      m.ny,
      m.u,
      scale,
      m.strokeIndex + 1,
      numFill,
      markColor,
    )
  }

  // Tiny green ✓ just past each completed stroke tip (outside the path).
  if (strokeDone) {
    for (let i = 0; i < medians.length; i++) {
      if (!strokeDone[i]) continue
      const tip = endMedianPointAndTangent(medians[i]!)
      if (!tip) continue
      const cx = tip.x + tip.tx * (u * 0.72)
      const cy = tip.y + tip.ty * (u * 0.72)
      drawStrokeDoneCheck(ctx, cx, cy, u, scale)
    }
  }
  ctx.restore()
}

function clearGuideCanvas(guide: HTMLCanvasElement | null): void {
  if (!guide) return
  const gctx = guide.getContext('2d')
  if (!gctx) return
  gctx.setTransform(1, 0, 0, 1, 0, 0)
  gctx.clearRect(0, 0, guide.width, guide.height)
}

function clearCanvasPixels(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

function blitCanvas(
  source: HTMLCanvasElement,
  dest: HTMLCanvasElement,
): void {
  const ctx = dest.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, dest.width, dest.height)
  ctx.drawImage(source, 0, 0, dest.width, dest.height)
}

/**
 * My-ink pass: recolor this-gesture paintBits pixels to done-green; erase only
 * those outside the generous stroke keep mask (extreme outliers). Leaves the
 * learner’s silhouette intact — no snap-to-guide morph.
 */
function applyMyInkStrokePass(
  store: HTMLCanvasElement,
  visible: HTMLCanvasElement | null,
  paintBits: Uint8Array,
  keepBits: Uint8Array,
  greenHex: string,
): void {
  const ctx = store.getContext('2d')
  if (!ctx) return
  const width = store.width
  const height = store.height
  if (width * height !== paintBits.length || keepBits.length !== paintBits.length) {
    return
  }
  let img: ImageData
  try {
    img = ctx.getImageData(0, 0, width, height)
  } catch {
    return
  }
  const data = img.data
  const raw = greenHex.replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const num = Number.parseInt(full, 16)
  const gr = Number.isNaN(num) ? 0x22 : (num >> 16) & 0xff
  const gg = Number.isNaN(num) ? 0xa0 : (num >> 8) & 0xff
  const gb = Number.isNaN(num) ? 0x6b : num & 0xff

  for (let i = 0; i < paintBits.length; i++) {
    if (!paintBits[i]) continue
    const o = i * 4
    if (data[o + 3]! < 8) continue
    if (!keepBits[i]) {
      data[o] = 0
      data[o + 1] = 0
      data[o + 2] = 0
      data[o + 3] = 0
      continue
    }
    data[o] = gr
    data[o + 1] = gg
    data[o + 2] = gb
    // Keep existing alpha so pressure/edge softens stay readable.
  }
  ctx.putImageData(img, 0, 0)
  if (visible) blitCanvas(store, visible)
}

/** Stroke/dot style shared by visible ink canvas and offscreen store. */
function prepareInkCtx(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  accent: string,
): number {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = accent
  ctx.fillStyle = accent
  const inkW = inkWidthCss()
  ctx.lineWidth = inkW
  return inkW
}


export default function TracePad({
  character,
  accent = DEFAULT_ACCENT,
  onDone,
  onProgressChange,
  onActiveLevelChange,
  levelPipsHost = null,
  nextCharAction = null,
  onAutoNextCharacter,
}: TracePadProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const writerHostRef = useRef<HTMLDivElement>(null)
  const guideCanvasRef = useRef<HTMLCanvasElement>(null)
  const inkCanvasRef = useRef<HTMLCanvasElement>(null)
  /** Offscreen ink archive — survives visible clears after strokes pass. */
  const inkStoreRef = useRef<HTMLCanvasElement | null>(null)

  const writerRef = useRef<HanziWriter | null>(null)
  const maskRef = useRef<LetterMask | null>(null)
  const sessionRef = useRef(0)
  const drawingRef = useRef(false)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)
  const doneRef = useRef(false)
  const levelRef = useRef(1)
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const phaseRef = useRef<Phase>('loading')
  const levelCountRef = useRef(0)
  const showMyStrokesRef = useRef(false)
  const prevStrokeDoneRef = useRef<boolean[] | null>(null)
  /** Last strokeDone snapshot — used to repaint green Guide after pass/resize. */
  const lastStrokeDoneRef = useRef<boolean[] | null>(null)
  /** True after a stroke passes in the current pen gesture — clear leftover purple on pen-up. */
  const gesturePassedStrokeRef = useRef(false)
  /**
   * Unique brush-coverage bits for the active stroke attempt (device px).
   * Compared to strokeAreas[active] * 1.5 for anti-scribble.
   */
  const paintBitsRef = useRef<Uint8Array | null>(null)
  /** Ink snapshot when the current stroke became active (restore on try-again). */
  const strokeBaselineRef = useRef<InkSnapshot | null>(null)
  const tryAgainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const demoEnabledRef = useRef(getDemoEnabled())
  const autoNextLevelRef = useRef(getAutoNextLevel())
  const onAutoNextCharacterRef = useRef(onAutoNextCharacter)
  /** When set, demo/skip restores writing/passed progress instead of wiping. */
  const demoKeepProgressRef = useRef<{
    returnPhase: 'writing' | 'passed'
    liveGrade: GradeStatus | null
    done: boolean
    prev: boolean[] | null
    last: boolean[] | null
  } | null>(null)

  const [strokeData, setStrokeData] = useState<StrokeCharacterData | undefined>(
    () => STROKE_DATA[character] ?? getStrokeData(character),
  )
  /** Progressive levels 1..strokeCount, plus final all-strokes memory. */
  const strokeCount = strokeData?.strokes.length ?? 0
  const levelCount = strokeCount > 0 ? strokeCount + 1 : 0
  levelCountRef.current = levelCount

  const [progress, setProgress] = useState<CharProgress>(() =>
    getCharProgress(character),
  )
  const [level, setLevel] = useState(1)
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  // Lazy-load stroke geometry for this character's classic HSK band.
  useEffect(() => {
    let cancelled = false
    const cached = STROKE_DATA[character] ?? getStrokeData(character)
    if (cached) {
      setStrokeData(cached)
    } else {
      setStrokeData(undefined)
      setPhase('loading')
      setLoadError(null)
    }
    void ensureCharacterStrokes(character)
      .then(() => {
        if (cancelled) return
        const data = STROKE_DATA[character] ?? getStrokeData(character)
        setStrokeData(data)
        if (!data) {
          setLoadError('Could not load stroke-order data for this character.')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStrokeData(undefined)
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Could not load stroke-order data for this character.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [character])

  const [liveGrade, setLiveGrade] = useState<GradeStatus | null>(null)
  /** false (default): guides on, hide completed hand ink. true: ink only. */
  const [showMyStrokes, setShowMyStrokes] = useState(false)
  const [demoEnabled, setDemoEnabledState] = useState(() => getDemoEnabled())
  const [autoNextLevel, setAutoNextLevelState] = useState(() =>
    getAutoNextLevel(),
  )
  const [soundEnabled, setSoundEnabledState] = useState(() => getSoundEnabled())
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  /** Short pad toast: “try again” (paint-cap) or “do stroke X first”. */
  const [padToast, setPadToast] = useState<string | null>(null)
  const [charCelebrate, setCharCelebrate] = useState<CharCelebrate | null>(null)
  const celebrateFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const celebrateAutoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Completed pen gestures (pen-down→up) this writing attempt — for Undo. */
  const gestureStackRef = useRef<InkSnapshot[]>([])
  const [gestureCount, setGestureCount] = useState(0)

  levelRef.current = level
  phaseRef.current = phase
  showMyStrokesRef.current = showMyStrokes
  demoEnabledRef.current = demoEnabled
  autoNextLevelRef.current = autoNextLevel
  onAutoNextCharacterRef.current = onAutoNextCharacter

  /** Apply speak result: clear note on success; only warn when speak truly fails. */
  const applySpeakResult = useCallback((result: SpeakResult) => {
    if (result === 'ok' || result === 'skipped') {
      setVoiceNote(null)
    } else if (result === 'no-voice' || result === 'unsupported') {
      setVoiceNote('No Mandarin voice on this device — Sound skipped.')
    }
  }, [])

  /** Automatic speak (level start / complete) — gated by Sound preference. */
  const maybeSpeak = useCallback(async () => {
    if (!getSoundEnabled()) return
    const result: SpeakResult = await speakHanzi(character)
    applySpeakResult(result)
  }, [character, applySpeakResult])

  const levelPipsRef = useRef<HTMLDivElement>(null)
  const [pipsOverflow, setPipsOverflow] = useState(false)
  const [canScrollPipsLeft, setCanScrollPipsLeft] = useState(false)
  const [canScrollPipsRight, setCanScrollPipsRight] = useState(false)

  // Cancel in-flight TTS when leaving this character.
  useEffect(() => {
    setVoiceNote(null)
    setCharCelebrate(null)
    if (celebrateFadeTimerRef.current != null) {
      clearTimeout(celebrateFadeTimerRef.current)
      celebrateFadeTimerRef.current = null
    }
    if (celebrateAutoDismissRef.current != null) {
      clearTimeout(celebrateAutoDismissRef.current)
      celebrateAutoDismissRef.current = null
    }
    return () => {
      cancelSpeech()
    }
  }, [character])

  const dismissCharCelebrate = useCallback(() => {
    setCharCelebrate((prev) => {
      if (!prev || prev.fading) return prev
      return { ...prev, fading: true }
    })
  }, [])

  // Finish fade-out → unmount celebrate overlay.
  useEffect(() => {
    if (!charCelebrate?.fading) return
    if (celebrateFadeTimerRef.current != null) {
      clearTimeout(celebrateFadeTimerRef.current)
    }
    celebrateFadeTimerRef.current = setTimeout(() => {
      celebrateFadeTimerRef.current = null
      setCharCelebrate(null)
    }, CHAR_CELEBRATE_FADE_MS)
    return () => {
      if (celebrateFadeTimerRef.current != null) {
        clearTimeout(celebrateFadeTimerRef.current)
        celebrateFadeTimerRef.current = null
      }
    }
  }, [charCelebrate?.fading])

  // Auto next ON: soft-dismiss celebrate ~2s (advance usually leaves sooner).
  useEffect(() => {
    if (!charCelebrate || charCelebrate.fading) return
    if (!autoNextLevel) return
    if (celebrateAutoDismissRef.current != null) {
      clearTimeout(celebrateAutoDismissRef.current)
    }
    celebrateAutoDismissRef.current = setTimeout(() => {
      celebrateAutoDismissRef.current = null
      dismissCharCelebrate()
    }, CHAR_CELEBRATE_AUTO_DISMISS_MS)
    return () => {
      if (celebrateAutoDismissRef.current != null) {
        clearTimeout(celebrateAutoDismissRef.current)
        celebrateAutoDismissRef.current = null
      }
    }
  }, [charCelebrate, autoNextLevel, dismissCharCelebrate])

  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current != null) {
      clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
  }, [])

  const notifyProgress = useCallback(
    (next: CharProgress) => {
      setProgress(next)
      onProgressChange?.(next, levelCount)
    },
    [levelCount, onProgressChange],
  )

  useEffect(() => {
    onActiveLevelChange?.(level, progress.beaten.includes(level))
  }, [level, progress.beaten, onActiveLevelChange])

  const stageCssSize = () => {
    const wrap = wrapRef.current
    if (!wrap) return 1
    const w = wrap.clientWidth
    const h = wrap.clientHeight || w
    return Math.max(1, Math.round(Math.min(w, h)))
  }

  const ensureInkStore = useCallback(() => {
    if (!inkStoreRef.current) {
      inkStoreRef.current = document.createElement('canvas')
    }
    return inkStoreRef.current
  }, [])

  const resizeCanvases = useCallback(() => {
    const wrap = wrapRef.current
    const guide = guideCanvasRef.current
    const ink = inkCanvasRef.current
    if (!wrap || !guide || !ink) return
    const cssSize = stageCssSize()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const px = Math.round(cssSize * dpr)
    const store = ensureInkStore()
    for (const canvas of [guide, ink, store]) {
      canvas.width = px
      canvas.height = px
    }
    // Use the square cssSize explicitly — width/height 100% stretches the
    // bitmap when the stage is non-square (aspect-ratio + max-height clamp)
    // and desyncs guide geometry from pointer ink / HanziWriter.
    const wrapW = wrap.clientWidth
    const wrapH = wrap.clientHeight || wrapW
    const left = Math.round((wrapW - cssSize) / 2)
    const top = Math.round((wrapH - cssSize) / 2)
    for (const canvas of [guide, ink]) {
      canvas.style.width = `${cssSize}px`
      canvas.style.height = `${cssSize}px`
      canvas.style.left = `${left}px`
      canvas.style.top = `${top}px`
      canvas.style.right = 'auto'
      canvas.style.bottom = 'auto'
    }
    return { cssSize, dpr }
  }, [ensureInkStore])

  const blitStoreToVisible = useCallback(() => {
    const ink = inkCanvasRef.current
    const store = inkStoreRef.current
    if (!ink || !store) return
    blitCanvas(store, ink)
  }, [])

  const clearVisibleInkOnly = useCallback(() => {
    clearCanvasPixels(inkCanvasRef.current)
  }, [])

  const paintGuide = useCallback(
    (levelNum: number, strokeDone?: boolean[] | null) => {
      const guide = guideCanvasRef.current
      const wrap = wrapRef.current
      if (!guide || !wrap || !strokeData) return
      const cssSize = stageCssSize()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const ctx = guide.getContext('2d')
      if (!ctx) return

      // Level 1: all guides. Level k (2..strokeCount): hide 0..(k-2).
      // Final level strokeCount+1: fromStroke === strokeCount → no incomplete guides.
      const fromStroke = levelNum <= 1 ? 0 : levelNum - 1
      drawStrokeGuides(
        ctx,
        cssSize,
        dpr,
        strokeData.strokes,
        strokeData.medians,
        fromStroke,
        accent,
        strokeDone,
      )
    },
    [accent, strokeData],
  )

  const rebuildMask = useCallback(async () => {
    const wrap = wrapRef.current
    if (!wrap || !strokeData) return null
    const cssSize = stageCssSize()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const mask = buildLetterMask(
      strokeData.strokes,
      cssSize,
      cssSize,
      dpr,
      strokeData.medians,
    )
    maskRef.current = mask
    return mask
  }, [strokeData])

  const resetGestureHistory = useCallback(() => {
    gestureStackRef.current = []
    setGestureCount(0)
  }, [])

  const captureInkSnapshot = useCallback((): InkSnapshot | null => {
    const mask = maskRef.current
    if (!mask) return null
    const store = inkStoreRef.current
    let storePixels: ImageData | null = null
    if (store && store.width > 0 && store.height > 0) {
      const ctx = store.getContext('2d')
      if (ctx) {
        try {
          storePixels = ctx.getImageData(0, 0, store.width, store.height)
        } catch {
          storePixels = null
        }
      }
    }
    return {
      storePixels,
      inkBits: new Uint8Array(mask.inkBits),
      cellInk: mask.cellInk.slice(),
      strokeDone: prevStrokeDoneRef.current
        ? prevStrokeDoneRef.current.slice()
        : null,
    }
  }, [])

  const clearPaintBits = useCallback(() => {
    const bits = paintBitsRef.current
    if (bits) bits.fill(0)
  }, [])

  const ensurePaintBits = useCallback((mask: LetterMask): Uint8Array => {
    const need = mask.width * mask.height
    let bits = paintBitsRef.current
    if (!bits || bits.length !== need) {
      bits = new Uint8Array(need)
      paintBitsRef.current = bits
    }
    return bits
  }, [])

  const showPadToast = useCallback((message: string) => {
    if (tryAgainTimerRef.current) {
      clearTimeout(tryAgainTimerRef.current)
    }
    setPadToast(message)
    // Match CSS fade (~1.1s): shorter, sits above ink so it doesn't cover the stroke.
    tryAgainTimerRef.current = setTimeout(() => {
      setPadToast(null)
      tryAgainTimerRef.current = null
    }, 1100)
  }, [])

  /** Baseline for the active stroke — restore on 150% try-again. */
  const captureStrokeBaseline = useCallback(() => {
    // Inline snapshot (same as captureInkSnapshot) so we don't depend on order.
    const mask = maskRef.current
    if (!mask) {
      strokeBaselineRef.current = null
      clearPaintBits()
      return
    }
    const store = inkStoreRef.current
    let storePixels: ImageData | null = null
    if (store && store.width > 0 && store.height > 0) {
      const ctx = store.getContext('2d')
      if (ctx) {
        try {
          storePixels = ctx.getImageData(0, 0, store.width, store.height)
        } catch {
          storePixels = null
        }
      }
    }
    strokeBaselineRef.current = {
      storePixels,
      inkBits: new Uint8Array(mask.inkBits),
      cellInk: mask.cellInk.slice(),
      strokeDone: prevStrokeDoneRef.current
        ? prevStrokeDoneRef.current.slice()
        : null,
    }
    clearPaintBits()
  }, [clearPaintBits])

  const applyInkSnapshot = useCallback(
    (snap: InkSnapshot | null) => {
      const store = ensureInkStore()
      const mask = maskRef.current
      if (!snap) {
        clearCanvasPixels(inkCanvasRef.current)
        clearCanvasPixels(store)
        prevStrokeDoneRef.current = null
        lastStrokeDoneRef.current = null
        clearPaintBits()
        if (mask) {
          clearInk(mask)
          const status = evaluateGrade(mask, null)
          setLiveGrade(status)
          paintGuide(levelRef.current, status.strokeDone)
          strokeBaselineRef.current = {
            storePixels: null,
            inkBits: new Uint8Array(mask.inkBits),
            cellInk: mask.cellInk.slice(),
            strokeDone: null,
          }
        } else {
          setLiveGrade(null)
          strokeBaselineRef.current = null
          if (!showMyStrokesRef.current) {
            paintGuide(levelRef.current, null)
          } else {
            clearGuideCanvas(guideCanvasRef.current)
          }
        }
        return
      }

      const sctx = store.getContext('2d')
      if (sctx) {
        sctx.setTransform(1, 0, 0, 1, 0, 0)
        sctx.clearRect(0, 0, store.width, store.height)
        if (
          snap.storePixels &&
          snap.storePixels.width === store.width &&
          snap.storePixels.height === store.height
        ) {
          sctx.putImageData(snap.storePixels, 0, 0)
        }
      }

      if (mask) {
        if (snap.inkBits.length === mask.inkBits.length) {
          mask.inkBits.set(snap.inkBits)
        } else {
          clearInk(mask)
        }
        for (let i = 0; i < mask.cellInk.length; i++) {
          mask.cellInk[i] = snap.cellInk[i] ?? 0
        }
      }

      prevStrokeDoneRef.current = snap.strokeDone
        ? snap.strokeDone.slice()
        : null
      lastStrokeDoneRef.current = snap.strokeDone
        ? snap.strokeDone.slice()
        : null

      const ink = inkCanvasRef.current
      if (showMyStrokesRef.current && ink) {
        blitCanvas(store, ink)
      } else {
        clearCanvasPixels(ink)
      }

      const status = mask
        ? evaluateGrade(mask, prevStrokeDoneRef.current)
        : null
      setLiveGrade(status)
      if (!showMyStrokesRef.current) {
        paintGuide(levelRef.current, status?.strokeDone ?? null)
      } else {
        clearGuideCanvas(guideCanvasRef.current)
      }
      clearPaintBits()
      // Undo/restore: treat restored state as the new stroke baseline.
      strokeBaselineRef.current = snap
        ? {
            storePixels: snap.storePixels,
            inkBits: new Uint8Array(snap.inkBits),
            cellInk: snap.cellInk.slice(),
            strokeDone: snap.strokeDone ? snap.strokeDone.slice() : null,
          }
        : null
    },
    [clearPaintBits, ensureInkStore, paintGuide],
  )

  const clearInkCanvas = useCallback(() => {
    resetGestureHistory()
    clearCanvasPixels(inkCanvasRef.current)
    clearCanvasPixels(inkStoreRef.current)
    prevStrokeDoneRef.current = null
    lastStrokeDoneRef.current = null
    clearPaintBits()
    strokeBaselineRef.current = null
    if (maskRef.current) {
      clearInk(maskRef.current)
      const status = evaluateGrade(maskRef.current, null)
      setLiveGrade(status)
      if (!showMyStrokesRef.current) {
        paintGuide(levelRef.current, status.strokeDone)
      } else {
        clearGuideCanvas(guideCanvasRef.current)
      }
      // Fresh attempt starts at stroke 0.
      strokeBaselineRef.current = {
        storePixels: null,
        inkBits: new Uint8Array(maskRef.current.inkBits),
        cellInk: maskRef.current.cellInk.slice(),
        strokeDone: null,
      }
    } else {
      setLiveGrade(null)
      if (!showMyStrokesRef.current) {
        paintGuide(levelRef.current, null)
      } else {
        clearGuideCanvas(guideCanvasRef.current)
      }
    }
  }, [clearPaintBits, paintGuide, resetGestureHistory])

  const hideWriterHost = useCallback(() => {
    const host = writerHostRef.current
    if (host) {
      host.style.opacity = '0'
      host.style.pointerEvents = 'none'
    }
  }, [])

  const restoreInkFromDataUrl = useCallback(
    (dataUrl: string, session: number, showInk: boolean) => {
      const ink = inkCanvasRef.current
      const store = ensureInkStore()
      if (!ink || !dataUrl) return
      const img = new Image()
      img.onload = () => {
        if (sessionRef.current !== session) return
        const sctx = store.getContext('2d')
        if (sctx) {
          sctx.setTransform(1, 0, 0, 1, 0, 0)
          sctx.clearRect(0, 0, store.width, store.height)
          sctx.drawImage(img, 0, 0, store.width, store.height)
        }
        if (showInk) {
          blitCanvas(store, ink)
        } else {
          clearCanvasPixels(ink)
        }
      }
      img.src = dataUrl
    },
    [ensureInkStore],
  )

  /** Review a beaten level: guide XOR ink (default = green guide, like post-clear). */
  const enterReviewMode = useCallback(
    (levelNum: number) => {
      clearAutoAdvance()
      const session = ++sessionRef.current
      doneRef.current = true
      setLevel(levelNum)
      levelRef.current = levelNum
      setPhase('passed')
      setLiveGrade(null)
      setLoadError(null)
      // Match post-clear default: green guide only (Show my strokes off).
      setShowMyStrokes(false)
      showMyStrokesRef.current = false

      hideWriterHost()
      resizeCanvases()
      clearInkCanvas()
      // Review: mutually exclusive — guide by default; ink stays in store for toggle.
      const done =
        lastStrokeDoneRef.current ??
        (strokeData
          ? strokeData.strokes.map(() => true)
          : null)
      if (done) {
        lastStrokeDoneRef.current = done
        paintGuide(levelNum, done)
      } else {
        clearGuideCanvas(guideCanvasRef.current)
      }

      const dataUrl = getLevelInk(character, levelNum)
      if (dataUrl) {
        restoreInkFromDataUrl(dataUrl, session, false)
      }
    },
    [
      character,
      clearAutoAdvance,
      clearInkCanvas,
      hideWriterHost,
      paintGuide,
      resizeCanvases,
      restoreInkFromDataUrl,
      strokeData,
    ],
  )

  const enterWritingAfterDemo = useCallback(
    async (levelNum: number, session: number) => {
      hideWriterHost()
      await rebuildMask()
      if (sessionRef.current !== session) return
      const mask = maskRef.current
      prevStrokeDoneRef.current = null
      const status = mask ? evaluateGrade(mask, null) : null
      setLiveGrade(status)
      paintGuide(levelNum, status?.strokeDone ?? null)
      if (mask) ensurePaintBits(mask)
      captureStrokeBaseline()
      setPhase('writing')
    },
    [
      captureStrokeBaseline,
      ensurePaintBits,
      hideWriterHost,
      paintGuide,
      rebuildMask,
    ],
  )

  /** Schedule auto-advance from the passed clear bar (level or next character). */
  const scheduleAutoAdvanceFromPassed = useCallback(() => {
    clearAutoAdvance()
    if (!autoNextLevelRef.current) return
    const passedLevel = levelRef.current
    const total = levelCountRef.current
    const nextLevel = passedLevel + 1
    const delay =
      nextLevel > total ? CHAR_CLEAR_AUTO_ADVANCE_MS : AUTO_ADVANCE_MS
    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null
      if (!autoNextLevelRef.current) return
      if (nextLevel > total) {
        // Last level cleared → next character (celebrate hold).
        onAutoNextCharacterRef.current?.()
        return
      }
      if (!isLevelUnlocked(character, nextLevel)) return
      // Unbeaten next → demo+write; beaten next → review (rare).
      if (isLevelBeaten(character, nextLevel)) {
        enterReviewMode(nextLevel)
      } else {
        clearAutoAdvance()
        sessionRef.current += 1
        setLevel(nextLevel)
        levelRef.current = nextLevel
        doneRef.current = false
        void runDemoThenWriteRef.current?.(nextLevel)
      }
    }, delay)
  }, [character, clearAutoAdvance, enterReviewMode])

  const finishPass = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    setPhase('passed')

    // Keep green Guide visible after clear (resize/pass used to wipe the canvas).
    const done =
      lastStrokeDoneRef.current ??
      (strokeData
        ? strokeData.strokes.map(() => true)
        : null)
    if (done && !showMyStrokesRef.current) {
      paintGuide(levelRef.current, done)
    }

    let inkDataUrl: string | undefined
    try {
      // Prefer offscreen store — visible ink may already be cleared.
      inkDataUrl =
        inkStoreRef.current?.toDataURL('image/png') ??
        inkCanvasRef.current?.toDataURL('image/png') ??
        undefined
    } catch {
      inkDataUrl = undefined
    }

    const beaten = markLevelBeaten(character, levelRef.current, inkDataUrl)
    notifyProgress(beaten)
    void maybeSpeak()
    if (beaten.beaten.length >= levelCountRef.current) {
      onDone?.()
      setCharCelebrate({ dots: makeCelebrateDots(), fading: false })
    }

    scheduleAutoAdvanceFromPassed()
  }, [
    character,
    maybeSpeak,
    notifyProgress,
    onDone,
    paintGuide,
    scheduleAutoAdvanceFromPassed,
    strokeData,
  ])

  const checkGrade = useCallback(() => {
    const mask = maskRef.current
    if (!mask || doneRef.current) return
    // Ordered strokes: only the first incomplete stroke (vs prev) may pass.
    const status = evaluateGrade(mask, prevStrokeDoneRef.current)
    setLiveGrade(status)

    const showInk = showMyStrokesRef.current
    if (showInk) {
      clearGuideCanvas(guideCanvasRef.current)
    } else {
      // Live: green fills for completed strokes + X/Y meter via liveGrade.
      paintGuide(levelRef.current, status.strokeDone)
    }

    const prev = prevStrokeDoneRef.current
    const newlyDoneIdxs: number[] = []
    if (status.strokeDone) {
      for (let i = 0; i < status.strokeDone.length; i++) {
        if (status.strokeDone[i] && !(prev && prev[i])) newlyDoneIdxs.push(i)
      }
    }
    const newlyDone = newlyDoneIdxs.length > 0
    prevStrokeDoneRef.current = status.strokeDone
      ? status.strokeDone.slice()
      : null
    if (status.strokeDone) {
      lastStrokeDoneRef.current = status.strokeDone.slice()
    }

    // Guide mode: after a stroke passes, hide hand ink so only the green
    // guide remains. Extra writing after that stays accent-purple and still
    // stamps toward remaining strokes. Mark this gesture so pen-up clears
    // any post-success leftover purple immediately (not on the next stroke).
    if (!showInk && (newlyDone || status.pass)) {
      clearCanvasPixels(inkCanvasRef.current)
      if (newlyDone) gesturePassedStrokeRef.current = true
    }

    // My ink ON: turn this gesture’s ink green (readable) and trim only
    // extreme outliers far from the passed stroke path — keep the silhouette.
    if (showInk && newlyDone && strokeData) {
      const store = inkStoreRef.current ?? ensureInkStore()
      const paintBits = paintBitsRef.current
      if (store && paintBits && paintBits.length === mask.width * mask.height) {
        const cssSize = stageCssSize()
        const contentCenter = contentCenterFromMedians(strokeData.medians)
        const keepBits = new Uint8Array(mask.width * mask.height)
        for (const si of newlyDoneIdxs) {
          const path = strokeData.strokes[si] ?? ''
          const median = mask.mappedStrokes[si] ?? []
          const strokeKeep = buildStrokeKeepBits(
            path,
            median,
            cssSize,
            mask.width,
            mask.height,
            mask.dpr,
            contentCenter,
          )
          for (let i = 0; i < keepBits.length; i++) {
            if (strokeKeep[i]) keepBits[i] = 1
          }
        }
        applyMyInkStrokePass(
          store,
          inkCanvasRef.current,
          paintBits,
          keepBits,
          DONE_STROKE_GREEN,
        )
      }
      if (newlyDone) gesturePassedStrokeRef.current = true
    }

    // New active stroke → reset paint-cap accumulator + baseline for retry.
    if (newlyDone && !status.pass) {
      captureStrokeBaseline()
    }

    if (status.pass) {
      finishPass()
    }
  }, [captureStrokeBaseline, ensureInkStore, finishPass, paintGuide, strokeData])

  const runDemoThenWrite = useCallback(
    async (levelNum: number) => {
      const session = sessionRef.current
      const writer = writerRef.current
      const host = writerHostRef.current
      if (!writer || !host || !strokeData) return

      void maybeSpeak()
      clearAutoAdvance()
      demoKeepProgressRef.current = null
      doneRef.current = false
      setLiveGrade(null)
      setLoadError(null)
      setShowMyStrokes(false)
      showMyStrokesRef.current = false
      prevStrokeDoneRef.current = null
      gesturePassedStrokeRef.current = false

      resizeCanvases()
      clearInkCanvas()
      clearGuideCanvas(guideCanvasRef.current)

      // Demo off: skip animated stroke-order playback and go straight to Guide.
      if (!demoEnabledRef.current) {
        hideWriterHost()
        await enterWritingAfterDemo(levelNum, session)
        return
      }

      setPhase('demo')

      // Show writer for demo; hide freehand canvases' interaction feel.
      host.style.opacity = '1'
      host.style.pointerEvents = 'none'

      try {
        writer.cancelQuiz()
        await writer.hideCharacter()
        await writer.showOutline()
        await writer.animateCharacter()
      } catch {
        // Animation may be cancelled by teardown / skip.
      }
      if (sessionRef.current !== session) return

      try {
        await writer.hideCharacter()
        await writer.hideOutline()
      } catch {
        /* ignore */
      }
      if (sessionRef.current !== session) return

      await enterWritingAfterDemo(levelNum, session)
    },
    [
      clearAutoAdvance,
      clearInkCanvas,
      enterWritingAfterDemo,
      hideWriterHost,
      maybeSpeak,
      resizeCanvases,
      strokeData,
    ],
  )

  // Keep a stable ref so finishPass auto-advance can call the latest runner.
  const runDemoThenWriteRef = useRef(runDemoThenWrite)
  runDemoThenWriteRef.current = runDemoThenWrite

  // Init / character change: create writer, pick starting level, run demo or review.
  useEffect(() => {
    const host = writerHostRef.current
    const wrap = wrapRef.current
    if (!host || !wrap) return

    clearAutoAdvance()

    // Band lazy-load: re-run when strokeData arrives (deps include strokeData).
    const live = STROKE_DATA[character] ?? getStrokeData(character)
    if (!live) {
      setPhase('loading')
      return
    }
    // Skip one frame when character flips before ensure effect updates state.
    if (strokeData !== live) return
    setLoadError(null)

    const session = ++sessionRef.current
    const initialProgress = getCharProgress(character)
    setProgress(initialProgress)
    onProgressChange?.(initialProgress, strokeData.strokes.length)

    // Start at highest unlocked unbeaten level, else last unlocked.
    const total = strokeData.strokes.length
    let startLevel = 1
    for (let L = 1; L <= total; L++) {
      if (!isLevelUnlocked(character, L)) break
      startLevel = L
      if (!isLevelBeaten(character, L)) break
    }
    setLevel(startLevel)
    levelRef.current = startLevel
    setPhase('loading')
    setLoadError(null)
    doneRef.current = false
    maskRef.current = null

    host.replaceChildren()
    host.style.opacity = '1'

    const size = stageCssSize()
    const writer = HanziWriter.create(host, character, {
      width: size,
      height: size,
      padding: HANZI_PADDING,
      showOutline: true,
      showCharacter: false,
      strokeColor: accent,
      radicalColor: accent,
      outlineColor: lighten(accent, 110),
      highlightColor: accent,
      drawingColor: accent,
      strokeHighlightSpeed: GUIDE_HIGHLIGHT_SPEED,
      strokeAnimationSpeed: GUIDE_ANIM_SPEED,
      delayBetweenStrokes: 280,
      strokeFadeDuration: 180,
      drawingWidth: 6,
      strokeWidth: 3,
      charDataLoader,
      onLoadCharDataError: () => {
        if (sessionRef.current === session) {
          setLoadError('Could not load stroke-order data for this character.')
        }
      },
    })
    writerRef.current = writer

    void (async () => {
      try {
        await writer.getCharacterData()
      } catch {
        if (sessionRef.current === session) {
          setLoadError('Could not load stroke-order data for this character.')
        }
        return
      }
      if (sessionRef.current !== session) return
      resizeCanvases()
      if (isLevelBeaten(character, startLevel)) {
        enterReviewMode(startLevel)
      } else {
        await runDemoThenWrite(startLevel)
      }
    })()

    return () => {
      clearAutoAdvance()
      sessionRef.current += 1
      try {
        writer.cancelQuiz()
      } catch {
        /* ignore */
      }
      writerRef.current = null
      host.replaceChildren()
    }
    // strokeData: cold practice URL must init after band chunk lands.
  }, [character, accent, strokeData])

  // Resize observer: rebuild canvases when the stage size actually changes.
  // Skip no-op / degenerate sizes so layout recovery does not wipe ink+guide.
  const lastStageSizeRef = useRef(0)
  useEffect(() => {
    const wrap = wrapRef.current
    const slot = wrap?.parentElement
    if (!wrap) return
    const observer = new ResizeObserver(() => {
      const size = stageCssSize()
      // Ignore collapsed layout (density flex bug / first paint) and no-ops.
      if (size <= 8) return
      if (size === lastStageSizeRef.current) return
      lastStageSizeRef.current = size

      const writer = writerRef.current
      writer?.updateDimensions({
        width: size,
        height: size,
        padding: HANZI_PADDING,
      })
      resizeCanvases()
      if (phase === 'writing' && !doneRef.current) {
        // Real size change: mask must match new pixels. Clearing ink is intentional
        // for geometry, but we always repaint the guide afterward (not blank).
        void rebuildMask().then(() => {
          clearInkCanvas()
          if (!showMyStrokesRef.current) {
            paintGuide(levelRef.current, null)
          }
        })
      } else if (phase === 'passed') {
        // resizeCanvases() clears pixels — restore guide XOR ink (never both).
        const done =
          lastStrokeDoneRef.current ??
          (strokeData
            ? strokeData.strokes.map(() => true)
            : null)
        if (showMyStrokesRef.current) {
          clearGuideCanvas(guideCanvasRef.current)
          const dataUrl = getLevelInk(character, levelRef.current)
          if (dataUrl) {
            restoreInkFromDataUrl(
              dataUrl,
              sessionRef.current,
              true,
            )
          }
        } else if (done) {
          paintGuide(levelRef.current, done)
          clearCanvasPixels(inkCanvasRef.current)
        }
      } else if (phase === 'demo' || phase === 'loading') {
        // Fresh demo: paint default guide under writer. Keep-progress replay:
        // leave green guides / ink alone so completed strokes survive.
        if (
          !demoKeepProgressRef.current &&
          !showMyStrokesRef.current &&
          strokeData
        ) {
          paintGuide(levelRef.current, null)
        }
      }
    })
    observer.observe(wrap)
    if (slot) observer.observe(slot)
    return () => observer.disconnect()
  }, [
    phase,
    character,
    paintGuide,
    rebuildMask,
    resizeCanvases,
    clearInkCanvas,
    restoreInkFromDataUrl,
    strokeData,
  ])

  const selectLevel = (nextLevel: number) => {
    if (!strokeData) return
    if (nextLevel < 1 || nextLevel > levelCount) return
    if (!isLevelUnlocked(character, nextLevel)) return

    clearAutoAdvance()

    if (isLevelBeaten(character, nextLevel)) {
      enterReviewMode(nextLevel)
      return
    }

    // Unbeaten unlocked: demo then write (including re-tap current writing).
    sessionRef.current += 1
    setLevel(nextLevel)
    levelRef.current = nextLevel
    doneRef.current = false
    void runDemoThenWrite(nextLevel)
  }

  const restoreAfterKeepProgressDemo = () => {
    const keep = demoKeepProgressRef.current
    demoKeepProgressRef.current = null
    hideWriterHost()
    if (!keep) return
    doneRef.current = keep.done
    prevStrokeDoneRef.current = keep.prev
    lastStrokeDoneRef.current = keep.last
    setLiveGrade(keep.liveGrade)
    setPhase(keep.returnPhase)
    if (showMyStrokesRef.current) {
      clearGuideCanvas(guideCanvasRef.current)
      blitStoreToVisible()
    } else {
      paintGuide(levelRef.current, keep.last ?? keep.prev)
    }
  }

  const skipGuide = () => {
    if (phase !== 'demo') return
    const session = ++sessionRef.current
    const writer = writerRef.current
    try {
      writer?.cancelQuiz()
      void writer?.hideCharacter()
      void writer?.hideOutline()
    } catch {
      /* ignore */
    }
    if (demoKeepProgressRef.current) {
      restoreAfterKeepProgressDemo()
      return
    }
    void enterWritingAfterDemo(levelRef.current, session)
  }

  /** Replay demo animation only — keep ink, green guides, and grade progress. */
  const playDemoKeepProgress = async (
    returnPhase: 'writing' | 'passed',
  ) => {
    const writer = writerRef.current
    const host = writerHostRef.current
    if (!writer || !host || !strokeData) return

    const session = ++sessionRef.current
    demoKeepProgressRef.current = {
      returnPhase,
      liveGrade,
      done: doneRef.current,
      prev: prevStrokeDoneRef.current
        ? prevStrokeDoneRef.current.slice()
        : null,
      last: lastStrokeDoneRef.current
        ? lastStrokeDoneRef.current.slice()
        : null,
    }

    void maybeSpeak()
    setPhase('demo')
    host.style.opacity = '1'
    host.style.pointerEvents = 'none'

    try {
      writer.cancelQuiz()
      await writer.hideCharacter()
      await writer.showOutline()
      await writer.animateCharacter()
    } catch {
      // Animation may be cancelled by teardown / skip.
    }
    if (sessionRef.current !== session) return

    try {
      await writer.hideCharacter()
      await writer.hideOutline()
    } catch {
      /* ignore */
    }
    if (sessionRef.current !== session) return

    restoreAfterKeepProgressDemo()
  }

  const replayGuide = () => {
    if (phase === 'loading' || phase === 'demo') return
    if (phase !== 'writing' && phase !== 'passed') return
    clearAutoAdvance()
    void playDemoKeepProgress(phase)
  }

  const onClear = () => {
    if (phase !== 'writing' || doneRef.current) return
    clearInkCanvas()
  }

  /** Remove last completed pen gesture (pen-down → pen-up). Repeatable. */
  const onUndoStroke = () => {
    if (phase !== 'writing' || doneRef.current) return
    if (drawingRef.current) return
    const stack = gestureStackRef.current
    if (stack.length === 0) return
    stack.pop()
    setGestureCount(stack.length)
    const prev = stack.length > 0 ? stack[stack.length - 1]! : null
    applyInkSnapshot(prev)
  }

  useEffect(() => {
    return () => {
      if (tryAgainTimerRef.current) {
        clearTimeout(tryAgainTimerRef.current)
      }
    }
  }, [])

  /**
   * 150% paint cap: restore active-stroke baseline, toast "try again",
   * keep earlier completed strokes' green/progress.
   */
  const rejectStrokeOverpaint = useCallback(
    (pointerId?: number) => {
      const canvas = inkCanvasRef.current
      drawingRef.current = false
      lastPtRef.current = null
      if (canvas != null && pointerId != null) {
        try {
          canvas.releasePointerCapture(pointerId)
        } catch {
          /* ignore */
        }
      }
      const baseline = strokeBaselineRef.current
      applyInkSnapshot(baseline)
      // Re-assert baseline after restore (applyInkSnapshot also sets it).
      if (baseline) {
        strokeBaselineRef.current = {
          storePixels: baseline.storePixels,
          inkBits: new Uint8Array(baseline.inkBits),
          cellInk: baseline.cellInk.slice(),
          strokeDone: baseline.strokeDone ? baseline.strokeDone.slice() : null,
        }
      }
      clearPaintBits()
      gesturePassedStrokeRef.current = false
      const maskNow = maskRef.current
      const ooo =
        maskNow != null
          ? outOfOrderRequiredStroke(maskNow, prevStrokeDoneRef.current)
          : null
      if (ooo != null) {
        showPadToast(`do stroke ${ooo} first`)
      } else {
        showPadToast('try again')
      }
    },
    [applyInkSnapshot, clearPaintBits, showPadToast],
  )

  /** Stamp grading ink + paint-coverage; return true if 150% cap tripped. */
  const stampStrokePaint = useCallback(
    (
      mask: LetterMask,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): boolean => {
      stampInkSegment(mask, x0, y0, x1, y1)
      const paintBits = ensurePaintBits(mask)
      stampPaintBitsSegment(
        paintBits,
        mask.width,
        mask.height,
        mask.dpr,
        x0,
        y0,
        x1,
        y1,
      )
      const active = activeStrokeIndex(
        prevStrokeDoneRef.current,
        mask.mappedStrokes.length,
      )
      const area = mask.strokeAreas[active] ?? 0
      const painted = countSetBits(paintBits)
      return paintCapExceeded(painted, area)
    },
    [ensurePaintBits],
  )

  // Pointer drawing on ink canvas (+ offscreen store).
  useEffect(() => {
    const canvas = inkCanvasRef.current
    if (!canvas) return

    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }

    const inkTargets = () => {
      const store = inkStoreRef.current ?? ensureInkStore()
      return [canvas, store]
    }

    const onDown = (e: PointerEvent) => {
      if (phase !== 'writing' || doneRef.current) return
      e.preventDefault()
      canvas.setPointerCapture(e.pointerId)
      drawingRef.current = true
      const pt = getPos(e)
      lastPtRef.current = pt
      const mask = maskRef.current
      if (!mask) return
      const dpr = mask.dpr
      for (const target of inkTargets()) {
        const ctx = target.getContext('2d')
        if (!ctx) continue
        const inkW = prepareInkCtx(ctx, dpr, accent)
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, inkW / 2, 0, Math.PI * 2)
        ctx.fill()
      }
      if (stampStrokePaint(mask, pt.x, pt.y, pt.x, pt.y)) {
        rejectStrokeOverpaint(e.pointerId)
        return
      }
      checkGrade()
    }

    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current || phase !== 'writing' || doneRef.current) return
      e.preventDefault()
      const pt = getPos(e)
      const prev = lastPtRef.current ?? pt
      lastPtRef.current = pt
      const mask = maskRef.current
      if (!mask) return
      const dpr = mask.dpr
      for (const target of inkTargets()) {
        const ctx = target.getContext('2d')
        if (!ctx) continue
        prepareInkCtx(ctx, dpr, accent)
        ctx.beginPath()
        ctx.moveTo(prev.x, prev.y)
        ctx.lineTo(pt.x, pt.y)
        ctx.stroke()
      }
      if (stampStrokePaint(mask, prev.x, prev.y, pt.x, pt.y)) {
        rejectStrokeOverpaint(e.pointerId)
        return
      }
      checkGrade()
    }

    const onUp = (e: PointerEvent) => {
      if (!drawingRef.current) return
      drawingRef.current = false
      lastPtRef.current = null
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      checkGrade()
      // Out-of-order: ink would complete a later stroke while an earlier one
      // is still required — toast once per gesture (pen-up), not try-again.
      if (!doneRef.current) {
        const maskNow = maskRef.current
        if (maskNow) {
          const ooo = outOfOrderRequiredStroke(
            maskNow,
            prevStrokeDoneRef.current,
          )
          if (ooo != null) {
            showPadToast(`do stroke ${ooo} first`)
          }
        }
      }
      // Post-success extra purple from this stroke clears on pen-up, not when
      // the next stroke finally passes.
      if (
        gesturePassedStrokeRef.current &&
        !showMyStrokesRef.current
      ) {
        clearCanvasPixels(inkCanvasRef.current)
        gesturePassedStrokeRef.current = false
      }
      // Archive completed gesture for Undo (skip if level already passed).
      if (!doneRef.current) {
        const snap = captureInkSnapshot()
        if (snap) {
          gestureStackRef.current.push(snap)
          setGestureCount(gestureStackRef.current.length)
        }
      }
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [
    accent,
    phase,
    checkGrade,
    showPadToast,
    ensureInkStore,
    captureInkSnapshot,
    stampStrokePaint,
    rejectStrokeOverpaint,
  ])

  const toggleDemoEnabled = () => {
    const next = !demoEnabledRef.current
    setDemoEnabled(next)
    setDemoEnabledState(next)
    demoEnabledRef.current = next
  }

  const toggleAutoNextLevel = () => {
    const next = !autoNextLevelRef.current
    setAutoNextLevel(next)
    setAutoNextLevelState(next)
    autoNextLevelRef.current = next
    if (!next) {
      clearAutoAdvance()
    } else if (phaseRef.current === 'passed') {
      scheduleAutoAdvanceFromPassed()
    }
  }

  const toggleSoundEnabled = () => {
    const next = !soundEnabled
    setSoundEnabled(next)
    setSoundEnabledState(next)
    if (!next) {
      cancelSpeech()
      setVoiceNote(null)
    }
  }

  const toggleShowMyStrokes = () => {
    const next = !showMyStrokesRef.current
    setShowMyStrokes(next)
    showMyStrokesRef.current = next
    const mask = maskRef.current
    const done =
      lastStrokeDoneRef.current ??
      liveGrade?.strokeDone ??
      (mask ? evaluateGrade(mask, prevStrokeDoneRef.current).strokeDone : null) ??
      (strokeData ? strokeData.strokes.map(() => true) : null)
    if (next) {
      // Ink only — no green underlay (mutually exclusive with guide).
      clearGuideCanvas(guideCanvasRef.current)
      if (phase === 'passed') {
        const dataUrl = getLevelInk(character, levelRef.current)
        if (dataUrl) {
          restoreInkFromDataUrl(dataUrl, sessionRef.current, true)
        } else {
          blitStoreToVisible()
        }
      } else {
        blitStoreToVisible()
      }
    } else {
      if (done) paintGuide(levelRef.current, done)
      clearVisibleInkOnly()
    }
  }

  const beatenSet = new Set(progress.beaten)
  const charCleared = levelCount > 0 && beatenSet.size >= levelCount

  const strokeTotal = strokeData?.strokes.length ?? levelCount
  const strokesDone =
    liveGrade != null ? liveGrade.doneCount : 0

  const updatePipsScrollState = useCallback(() => {
    const strip = levelPipsRef.current
    if (!strip) return
    const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth)
    const overflow = maxScroll > 1
    setPipsOverflow(overflow)
    setCanScrollPipsLeft(overflow && strip.scrollLeft > 1)
    setCanScrollPipsRight(overflow && strip.scrollLeft < maxScroll - 1)
  }, [])

  const scrollPipsBy = useCallback(
    (dir: -1 | 1) => {
      const strip = levelPipsRef.current
      if (!strip) return
      const step = Math.max(strip.clientWidth * 0.6, 80)
      strip.scrollBy({ left: dir * step, behavior: 'smooth' })
    },
    [],
  )

  /** Keep the active level centered while levels remain ahead; clamp at ends. */
  useEffect(() => {
    const strip = levelPipsRef.current
    if (!strip || levelCount <= 0) return

    const active = strip.querySelector(
      '.level-pip.is-active',
    ) as HTMLElement | null
    if (!active) {
      updatePipsScrollState()
      return
    }

    const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth)
    if (maxScroll <= 1) {
      strip.scrollLeft = 0
      updatePipsScrollState()
      return
    }

    const activeCenter = active.offsetLeft + active.offsetWidth / 2
    const viewMid = strip.clientWidth / 2
    // Center active pip, but never push the last visible levels off-screen.
    const target = Math.max(0, Math.min(activeCenter - viewMid, maxScroll))
    strip.scrollTo({ left: target, behavior: 'smooth' })
    // Update arrows after smooth scroll settles a bit.
    const t = window.setTimeout(updatePipsScrollState, 220)
    return () => window.clearTimeout(t)
  }, [level, levelCount, updatePipsScrollState])

  useEffect(() => {
    const strip = levelPipsRef.current
    if (!strip) return
    updatePipsScrollState()
    const onScroll = () => updatePipsScrollState()
    strip.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => updatePipsScrollState())
    ro.observe(strip)
    return () => {
      strip.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [levelCount, updatePipsScrollState])

  const memoryHint =
    level <= 1
      ? 'Level 1: full stroke-path guide — trace the whole character.'
      : level > strokeCount
        ? 'Final memory: draw every stroke with no guide.'
        : `Memory: strokes 1–${level - 1} are hidden; later strokes still show a guide.`

  const demoReplayControls: ReactNode = (
    <div
      className="trace-stage-pair"
      role="group"
      aria-label="Demo and skip controls"
    >
      <button
        type="button"
        className={`trace-pair-btn${demoEnabled ? ' is-on' : ''}`}
        onClick={toggleDemoEnabled}
        aria-pressed={demoEnabled}
        aria-label={demoEnabled ? 'Demo on' : 'Demo off'}
        title="Animated stroke-order demo"
      >
        <span aria-hidden="true">{demoEnabled ? '▶' : '⏸'}</span>
        <span>{demoEnabled ? 'Demo on' : 'Demo off'}</span>
      </button>
      {(phase === 'demo' || phase === 'writing' || phase === 'passed') && (
        <button
          type="button"
          className="trace-pair-btn is-accent"
          onClick={phase === 'demo' ? skipGuide : replayGuide}
          disabled={!!loadError}
          aria-label={phase === 'demo' ? 'Skip demo' : 'Replay'}
          title={phase === 'demo' ? 'Skip demo' : 'Replay'}
        >
          {phase === 'demo' ? 'Skip' : 'Replay'}
        </button>
      )}
    </div>
  )

  const levelPipsStrip: ReactNode = (
    <div className="level-pips-row">
      <div
        className={`level-pips-wrap${pipsOverflow ? ' is-overflow' : ''}`}
        aria-label={`Levels beaten: ${beatenSet.size} of ${levelCount}`}
      >
      <button
        type="button"
        className="level-pips-arrow"
        aria-label="Scroll levels left"
        title="Earlier levels"
        disabled={!canScrollPipsLeft}
        onClick={() => scrollPipsBy(-1)}
        hidden={!pipsOverflow}
      >
        ‹
      </button>
      <div
        ref={levelPipsRef}
        className="level-pips"
        role="list"
      >
        {Array.from({ length: levelCount }, (_, i) => {
          const L = i + 1
          const unlocked = isLevelUnlocked(character, L)
          const beaten = beatenSet.has(L)
          const active = L === level
          return (
            <button
              key={L}
              type="button"
              role="listitem"
              className={[
                'level-pip',
                beaten ? 'is-beaten' : '',
                active ? 'is-active' : '',
                !unlocked ? 'is-locked' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                beaten || active
                  ? {
                      ['--pip' as string]: beaten
                        ? DONE_STROKE_GREEN
                        : accent,
                    }
                  : undefined
              }
              disabled={!unlocked || phase === 'demo' || phase === 'loading'}
              onClick={() => selectLevel(L)}
              aria-label={
                beaten
                  ? `Level ${L}, beaten${active ? ', selected' : ''}`
                  : unlocked
                    ? `Level ${L}${active ? ', selected' : ''}`
                    : `Level ${L}, locked`
              }
              title={
                unlocked
                  ? beaten
                    ? L > strokeCount
                      ? `Final memory (beaten) — tap to review`
                      : `Level ${L} (beaten) — tap to review`
                    : L > strokeCount
                      ? 'Final memory — all strokes, no guide'
                      : `Level ${L}`
                  : `Beat level ${L - 1} to unlock`
              }
            >
              <span className="level-pip-num">{L}</span>
              {beaten && (
                <span className="level-pip-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="level-pips-arrow"
        aria-label="Scroll levels right"
        title="Later levels"
        disabled={!canScrollPipsRight}
        onClick={() => scrollPipsBy(1)}
        hidden={!pipsOverflow}
      >
        ›
      </button>
      </div>
    </div>
  )


  const strokeProgressBadge: ReactNode =
    phase === 'writing' ? (
      <div
        className={`trace-pad-chrome-strokes grade-meter${liveGrade?.pass ? ' is-ok' : ''}`}
        aria-live="polite"
        aria-label={`${strokesDone} of ${strokeTotal} strokes completed`}
      >
        <span className="grade-meter-progress">
          {strokesDone}/{strokeTotal} strokes
        </span>
      </div>
    ) : null

  return (
    <div className="trace-pad">
      {levelPipsHost
        ? createPortal(levelPipsStrip, levelPipsHost)
        : levelPipsStrip}

      <div className="trace-stage-block">
        <div className="trace-pad-chrome" aria-label="Demo and stroke progress">
          {demoReplayControls}
          {strokeProgressBadge ?? <span className="trace-pad-chrome-spacer" aria-hidden="true" />}
        </div>
        <div className="trace-stage-slot">
          <div
            ref={wrapRef}
            className={`trace-stage${charCleared ? ' is-char-cleared' : ''}`}
            style={{ ['--accent' as string]: accent }}
          >
            <div className="tianzige" aria-hidden="true">
              <span className="tianzige-h" />
              <span className="tianzige-v" />
              <span className="tianzige-d1" />
              <span className="tianzige-d2" />
            </div>

            <canvas
              ref={guideCanvasRef}
              className="guide-canvas"
              aria-hidden="true"
            />

            <div
              ref={writerHostRef}
              className="hanzi-host"
              aria-hidden={phase !== 'demo'}
            />

            <canvas
              ref={inkCanvasRef}
              className="trace-canvas"
              aria-label={`Trace character ${character}, level ${level}`}
              style={{
                pointerEvents: phase === 'writing' ? 'auto' : 'none',
                opacity: phase === 'demo' ? 0 : 1,
              }}
            />

            {loadError && (
              <div className="trace-error" role="alert">
                {loadError}
              </div>
            )}
            {charCelebrate && (
              <div
                className={`trace-char-celebrate${charCelebrate.fading ? ' is-fading' : ''}`}
                aria-live="polite"
              >
                <div className="trace-char-celebrate-confetti" aria-hidden="true">
                  {charCelebrate.dots.map((d) => (
                    <span
                      key={d.id}
                      className="trace-char-celebrate-dot"
                      style={
                        {
                          '--dx': d.dx,
                          '--dy': d.dy,
                          '--dot-color': d.color,
                          '--dot-size': `${d.size}px`,
                          '--dot-delay': `${d.delay}ms`,
                          '--dot-dur': `${d.duration}ms`,
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="trace-char-celebrate-check"
                  onClick={dismissCharCelebrate}
                  aria-label={`${character} cleared, dismiss celebration`}
                >
                  <span aria-hidden="true">✓</span>
                </button>
                <div
                  className="trace-char-celebrate-toast"
                  role="status"
                  onClick={dismissCharCelebrate}
                >
                  <span className="trace-char-celebrate-toast-mark" aria-hidden="true">
                    ✓
                  </span>
                  <span>{character} cleared</span>
                  <button
                    type="button"
                    className="trace-char-celebrate-toast-x"
                    onClick={(e) => {
                      e.stopPropagation()
                      dismissCharCelebrate()
                    }}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
            {phase === 'passed' && (
              <div className="trace-clear-bar" role="group" aria-label="Level completed">
                <button
                  type="button"
                  className="trace-clear-bar-left"
                  onClick={replayGuide}
                  aria-label={`Level ${level} completed, click to replay`}
                  title="Replay this level"
                >
                  <span className="trace-check">✓</span>
                  <span>Level {level} completed</span>
                </button>
                <div className="trace-clear-bar-right">
                  {level < levelCount || autoNextLevel ? (
                    <button
                      type="button"
                      className={`trace-clear-bar-next trace-clear-bar-auto${
                        autoNextLevel ? ' is-on' : ''
                      }`}
                      onClick={toggleAutoNextLevel}
                      aria-pressed={autoNextLevel}
                      aria-label={
                        autoNextLevel ? 'Auto next on' : 'Auto next off'
                      }
                      title={
                        autoNextLevel
                          ? 'Auto-advance to next level or next character after clear'
                          : 'Stay put after clear'
                      }
                    >
                      <span aria-hidden="true">{autoNextLevel ? '▶' : '⏸'}</span>
                      <span>
                        {autoNextLevel ? 'Auto next on' : 'Auto next off'}
                      </span>
                    </button>
                  ) : (
                    nextCharAction
                  )}
                </div>
              </div>
            )}
            {padToast && (
              <div className="trace-try-again-toast" role="status" aria-live="polite">
                {padToast}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="trace-toolbar"
        role="toolbar"
        aria-label="Practice controls"
      >
        <button
          type="button"
          className={`dock-btn${showMyStrokes ? ' is-on' : ''}`}
          onClick={toggleShowMyStrokes}
          aria-pressed={showMyStrokes}
          aria-label={showMyStrokes ? 'My ink' : 'Guide'}
          title={showMyStrokes ? 'My ink' : 'Guide'}
          disabled={phase !== 'writing' && phase !== 'passed'}
        >
          <span className="dock-btn-icon dock-btn-mode-icon" aria-hidden="true">
            {showMyStrokes ? (
              <svg
                viewBox="0 0 24 24"
                width="1em"
                height="1em"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="1em"
                height="1em"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" opacity="0.45" />
                <path d="M7 17c2.5-6 5.5-9.5 10-11" />
                <circle cx="7" cy="17" r="1.25" fill="currentColor" stroke="none" />
              </svg>
            )}
          </span>
          <span className="dock-btn-label">
            {showMyStrokes ? 'My ink' : 'Guide'}
          </span>
        </button>
        <button
          type="button"
          className="dock-btn"
          onClick={onUndoStroke}
          disabled={phase !== 'writing' || gestureCount === 0}
          aria-label="Undo stroke"
          title="Remove the last pen stroke"
        >
          <span className="dock-btn-icon" aria-hidden="true">
            ↶
          </span>
          <span className="dock-btn-label">Undo</span>
        </button>
        <button
          type="button"
          className="dock-btn"
          onClick={onClear}
          disabled={phase !== 'writing'}
          aria-label="Clear"
          title="Clear ink"
        >
          <span className="dock-btn-icon" aria-hidden="true">
            ⌫
          </span>
          <span className="dock-btn-label">Clear</span>
        </button>
        <button
          type="button"
          className={`dock-btn dock-btn-sound${soundEnabled ? ' is-on' : ''}`}
          onClick={toggleSoundEnabled}
          aria-pressed={soundEnabled}
          aria-label={
            soundEnabled ? 'Auto sound on' : 'Auto sound off'
          }
          title={
            soundEnabled
              ? 'Auto pronunciation on — tap to turn off'
              : 'Auto pronunciation off — tap to turn on'
          }
        >
          <span className="dock-btn-icon dock-btn-sound-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="1em"
              height="1em"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12v3a3 3 0 0 0 3 3h1v-8H6a3 3 0 0 0-3 3z" />
              <path d="M21 12v3a3 3 0 0 1-3 3h-1v-8h1a3 3 0 0 1 3 3z" />
              <path d="M7 10V9a5 5 0 0 1 10 0v1" />
            </svg>
          </span>
          <span className="dock-btn-label">
            {soundEnabled ? 'Auto' : 'Off'}
          </span>
        </button>
      </div>
      {voiceNote && (
        <p className="trace-voice-note" role="status">
          {voiceNote}
        </p>
      )}
      <p className="trace-hint">
        {phase === 'passed' ? (
          <>
            Nice work. Tap a pip to review, or Replay to practice again.
          </>
        ) : phase === 'demo' ? (
          <>Demo playing — tap Skip to start tracing.</>
        ) : (
          <>{memoryHint}</>
        )}
      </p>
    </div>
  )
}
