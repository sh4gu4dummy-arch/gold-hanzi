import HanziWriter from 'hanzi-writer'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  STROKE_DATA,
  charDataLoader,
  ensureCharacterStrokes,
  getStrokeData,
} from '../data/strokeData'
import type { StrokeCharacterData } from '../data/strokeData'
import {
  HANZI_PADDING,
  applyHanziTransform,
  buildLetterMask,
  clearInk,
  contentCenterFromMedians,
  earlyMedianTangent,
  evaluateGrade,
  hanziScale,
  inkWidthCss,
  stampInkSegment,
} from '../lib/grading'
import type { GradeStatus, LetterMask } from '../lib/grading'
import {
  clearLevelInk,
  getCharProgress,
  getLevelInk,
  isLevelBeaten,
  isLevelUnlocked,
  markLevelBeaten,
} from '../lib/progress'
import type { CharProgress } from '../lib/progress'
import { getDemoEnabled, setDemoEnabled } from '../lib/demoPref'
import { getSoundEnabled, setSoundEnabled } from '../lib/soundPref'
import { cancelSpeech, speakHanzi } from '../lib/speak'
import type { SpeakResult } from '../lib/speak'
import { Link } from 'react-router-dom'

export const DEFAULT_ACCENT = '#7C5CBF'
/** Guide path fill when a stroke passes median grading (hit fraction + end band). */
export const DONE_STROKE_GREEN = '#22A06B'

/** ~2× slower than hanzi-writer defaults (speed 1). */
const GUIDE_ANIM_SPEED = 0.45
const GUIDE_HIGHLIGHT_SPEED = 0.5
const AUTO_ADVANCE_MS = 1000

type NextCharacterInfo = {
  id: string
  character: string
  pinyin: string
}

type TracePadProps = {
  character: string
  accent?: string
  onDone?: () => void
  onProgressChange?: (progress: CharProgress, levelCount: number) => void
  /**
   * When all levels of this character are cleared:
   * - object → Next character button
   * - null → end-of-list / all caught up
   * - undefined → still working through levels (hide next-char UI)
   */
  nextCharacter?: NextCharacterInfo | null
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
  const doneFill = hexToRgba(DONE_STROKE_GREEN, 0.42)

  const contentCenter = contentCenterFromMedians(medians)

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
      ctx.fillStyle = done ? doneFill : faintFill
      ctx.fill(path)
    } catch {
      // Ignore malformed path segments.
    }
  }

  // Numbers/arrows only for strokes that still show a live guide.
  const markers = layoutGuideMarkers(medians, fromStroke, u)
  for (const m of markers) {
    // Fan may shift the mark; keep the stroke tangent so the arrow
    // still reads as writing direction, not the fan axis.
    const ox = m.ox + m.offx
    const oy = m.oy + m.offy
    const done = !!strokeDone?.[m.strokeIndex]
    const markColor = done ? DONE_STROKE_GREEN : accent
    const numFill = done ? hexToRgba(DONE_STROKE_GREEN, 0.92) : markerFill
    if (m.hasTangent) {
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
  nextCharacter,
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
  const levelCountRef = useRef(0)
  const showMyStrokesRef = useRef(false)
  const prevStrokeDoneRef = useRef<boolean[] | null>(null)
  /** Last strokeDone snapshot — used to repaint green Guide after pass/resize. */
  const lastStrokeDoneRef = useRef<boolean[] | null>(null)
  /** True after a stroke passes in the current pen gesture — clear leftover purple on pen-up. */
  const gesturePassedStrokeRef = useRef(false)
  const demoEnabledRef = useRef(getDemoEnabled())

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
  const [soundEnabled, setSoundEnabledState] = useState(() => getSoundEnabled())
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  /** Completed pen gestures (pen-down→up) this writing attempt — for Undo. */
  const gestureStackRef = useRef<InkSnapshot[]>([])
  const [gestureCount, setGestureCount] = useState(0)

  levelRef.current = level
  showMyStrokesRef.current = showMyStrokes
  demoEnabledRef.current = demoEnabled

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

  /** Manual replay — always allowed, even when auto Sound is off. */
  const speakNow = useCallback(async () => {
    const result: SpeakResult = await speakHanzi(character)
    applySpeakResult(result)
  }, [character, applySpeakResult])

  const soundHoldTimerRef = useRef<number | null>(null)
  const soundDidLongPressRef = useRef(false)
  const levelPipsRef = useRef<HTMLDivElement>(null)
  const [pipsOverflow, setPipsOverflow] = useState(false)
  const [canScrollPipsLeft, setCanScrollPipsLeft] = useState(false)
  const [canScrollPipsRight, setCanScrollPipsRight] = useState(false)

  const clearSoundHoldTimer = useCallback(() => {
    if (soundHoldTimerRef.current != null) {
      window.clearTimeout(soundHoldTimerRef.current)
      soundHoldTimerRef.current = null
    }
  }, [])

  // Cancel in-flight TTS when leaving this character.
  useEffect(() => {
    setVoiceNote(null)
    return () => {
      cancelSpeech()
    }
  }, [character])

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
    // Fill the square stage; CSS absolute inset centers via host layout.
    for (const canvas of [guide, ink]) {
      canvas.style.width = '100%'
      canvas.style.height = '100%'
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

  const applyInkSnapshot = useCallback(
    (snap: InkSnapshot | null) => {
      const store = ensureInkStore()
      const mask = maskRef.current
      if (!snap) {
        clearCanvasPixels(inkCanvasRef.current)
        clearCanvasPixels(store)
        prevStrokeDoneRef.current = null
        lastStrokeDoneRef.current = null
        if (mask) {
          clearInk(mask)
          const status = evaluateGrade(mask)
          setLiveGrade(status)
          paintGuide(levelRef.current, status.strokeDone)
        } else {
          setLiveGrade(null)
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

      const status = mask ? evaluateGrade(mask) : null
      setLiveGrade(status)
      if (!showMyStrokesRef.current) {
        paintGuide(levelRef.current, status?.strokeDone ?? null)
      } else {
        clearGuideCanvas(guideCanvasRef.current)
      }
    },
    [ensureInkStore, paintGuide],
  )

  const clearInkCanvas = useCallback(() => {
    resetGestureHistory()
    clearCanvasPixels(inkCanvasRef.current)
    clearCanvasPixels(inkStoreRef.current)
    prevStrokeDoneRef.current = null
    if (maskRef.current) {
      clearInk(maskRef.current)
      const status = evaluateGrade(maskRef.current)
      setLiveGrade(status)
      if (!showMyStrokesRef.current) {
        paintGuide(levelRef.current, status.strokeDone)
      } else {
        clearGuideCanvas(guideCanvasRef.current)
      }
    } else {
      setLiveGrade(null)
      if (!showMyStrokesRef.current) {
        paintGuide(levelRef.current, null)
      } else {
        clearGuideCanvas(guideCanvasRef.current)
      }
    }
  }, [paintGuide, resetGestureHistory])

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
      const status = mask ? evaluateGrade(mask) : null
      setLiveGrade(status)
      paintGuide(levelNum, status?.strokeDone ?? null)
      setPhase('writing')
    },
    [hideWriterHost, paintGuide, rebuildMask],
  )

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
    onDone?.()

    clearAutoAdvance()
    const passedLevel = levelRef.current
    const total = levelCountRef.current
    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null
      const nextLevel = passedLevel + 1
      if (nextLevel > total) return
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
    }, AUTO_ADVANCE_MS)
  }, [
    character,
    clearAutoAdvance,
    enterReviewMode,
    maybeSpeak,
    notifyProgress,
    onDone,
    paintGuide,
    strokeData,
  ])

  const checkGrade = useCallback(() => {
    const mask = maskRef.current
    if (!mask || doneRef.current) return
    const status = evaluateGrade(mask)
    setLiveGrade(status)

    const showInk = showMyStrokesRef.current
    if (showInk) {
      clearGuideCanvas(guideCanvasRef.current)
    } else {
      // Live: green fills for completed strokes + X/Y meter via liveGrade.
      paintGuide(levelRef.current, status.strokeDone)
    }

    const prev = prevStrokeDoneRef.current
    const newlyDone =
      status.strokeDone?.some((d, i) => d && !(prev && prev[i])) ?? false
    prevStrokeDoneRef.current = status.strokeDone
      ? status.strokeDone.slice()
      : null
    if (status.strokeDone) {
      lastStrokeDoneRef.current = status.strokeDone.slice()
    }

    // After a stroke passes: hide hand ink so only the green guide remains.
    // Extra writing after that stays accent-purple and still stamps toward
    // remaining strokes. Also mark this gesture so pen-up clears any
    // post-success leftover purple immediately (not on the next stroke).
    if (!showInk && (newlyDone || status.pass)) {
      clearCanvasPixels(inkCanvasRef.current)
      if (newlyDone) gesturePassedStrokeRef.current = true
    }

    if (status.pass) {
      finishPass()
    }
  }, [finishPass, paintGuide])

  const runDemoThenWrite = useCallback(
    async (levelNum: number) => {
      const session = sessionRef.current
      const writer = writerRef.current
      const host = writerHostRef.current
      if (!writer || !host || !strokeData) return

      void maybeSpeak()
      clearAutoAdvance()
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

    if (!strokeData) {
      // Band chunk still loading (or failed — loadError set by ensure effect).
      setPhase('loading')
      return
    }
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
    // Intentionally only re-init on character/accent change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character, accent])

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
        // Ensure guide host dimensions stay in sync as layout settles.
        if (!showMyStrokesRef.current && strokeData) {
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
    void enterWritingAfterDemo(levelRef.current, session)
  }

  const replayGuide = () => {
    if (phase === 'loading' || phase === 'demo') return
    clearAutoAdvance()
    // Replay on a beaten level: leave review, clear saved ink, re-run demo+write.
    if (isLevelBeaten(character, level)) {
      const next = clearLevelInk(character, level)
      notifyProgress(next)
    }
    sessionRef.current += 1
    doneRef.current = false
    void runDemoThenWrite(level)
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

  const goNextLevel = () => {
    clearAutoAdvance()
    selectLevel(level + 1)
  }

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
      stampInkSegment(mask, pt.x, pt.y, pt.x, pt.y)
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
      stampInkSegment(mask, prev.x, prev.y, pt.x, pt.y)
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
  }, [accent, phase, checkGrade, ensureInkStore, captureInkSnapshot])

  const toggleDemoEnabled = () => {
    const next = !demoEnabledRef.current
    setDemoEnabled(next)
    setDemoEnabledState(next)
    demoEnabledRef.current = next
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

  const onSoundPointerDown = () => {
    soundDidLongPressRef.current = false
    clearSoundHoldTimer()
    soundHoldTimerRef.current = window.setTimeout(() => {
      soundHoldTimerRef.current = null
      soundDidLongPressRef.current = true
      toggleSoundEnabled()
    }, 400)
  }

  const onSoundPointerUp = () => {
    clearSoundHoldTimer()
  }

  const onSoundPointerCancel = () => {
    // Clear hold timer only — keep long-press flag so the following click is ignored.
    clearSoundHoldTimer()
  }

  const onSoundClick = () => {
    clearSoundHoldTimer()
    if (soundDidLongPressRef.current) {
      soundDidLongPressRef.current = false
      return
    }
    void speakNow()
  }

  const toggleShowMyStrokes = () => {
    const next = !showMyStrokesRef.current
    setShowMyStrokes(next)
    showMyStrokesRef.current = next
    const mask = maskRef.current
    const done =
      lastStrokeDoneRef.current ??
      liveGrade?.strokeDone ??
      (mask ? evaluateGrade(mask).strokeDone : null) ??
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
  const levelLabel =
    levelCount === 0
      ? 'Levels · Loading…'
      : phase === 'demo'
        ? `Levels · Level ${level} · Demo`
        : phase === 'passed'
          ? `Levels · Level ${level} cleared!`
          : `Levels · Level ${level} of ${levelCount}`

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

  return (
    <div className="trace-pad">
      <div className="stroke-progress" aria-live="polite">
        <span className="stroke-progress-label">{levelLabel}</span>
        {levelCount > 0 && (
          <div
            className="stroke-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={levelCount}
            aria-valuenow={beatenSet.size}
            aria-label={`${beatenSet.size} of ${levelCount} levels beaten`}
          >
            <span
              className="stroke-progress-fill"
              style={{
                width: `${(beatenSet.size / levelCount) * 100}%`,
                background: accent,
              }}
            />
          </div>
        )}
      </div>

      {(phase === 'writing' || phase === 'passed' || phase === 'demo') && (
        <div className="grade-meter-row">
          {phase === 'writing' && (
            <div
              className={`grade-meter${liveGrade?.pass ? ' is-ok' : ''}`}
              aria-live="polite"
              aria-label={`${strokesDone} of ${strokeTotal} strokes completed`}
            >
              <span className="grade-meter-progress">
                {strokesDone}/{strokeTotal} strokes
              </span>
            </div>
          )}
        </div>
      )}



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
                        ['--pip' as string]: accent,
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
                <span className="level-pip-dot" />
                <span className="level-pip-num">{L}</span>
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

            <div className="trace-stage-slot">
      <div
        ref={wrapRef}
        className={`trace-stage${phase === 'passed' ? ' is-done' : ''}`}
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
        {phase === 'passed' && (
          <div className="trace-success" role="status">
            <span className="trace-check">✓</span>
            <span>Level {level} cleared</span>
          </div>
        )}
        {(phase === 'demo' || phase === 'writing' || phase === 'passed') && (
          <button
            type="button"
            className="trace-corner-btn"
            onClick={phase === 'demo' ? skipGuide : replayGuide}
            disabled={!!loadError}
            aria-label={phase === 'demo' ? 'Skip demo' : 'Replay'}
            title={phase === 'demo' ? 'Skip demo' : 'Replay'}
          >
            {phase === 'demo' ? 'Skip' : 'Replay'}
          </button>
        )}
      </div>
      </div>

      <div
        className="trace-toolbar"
        role="toolbar"
        aria-label="Practice controls"
      >
        <button
          type="button"
          className={`icon-btn${demoEnabled ? ' is-on' : ''}`}
          onClick={toggleDemoEnabled}
          aria-pressed={demoEnabled}
          aria-label={demoEnabled ? 'Demo on' : 'Demo off'}
          title="Animated stroke-order Demo"
        >
          <span aria-hidden="true">{demoEnabled ? '▶' : '⏸'}</span>
        </button>
        <button
          type="button"
          className={`icon-btn${showMyStrokes ? ' is-on' : ''}`}
          onClick={toggleShowMyStrokes}
          aria-pressed={showMyStrokes}
          aria-label={showMyStrokes ? 'Show guides' : 'Show my strokes'}
          title={showMyStrokes ? 'Show guides' : 'Show my strokes'}
          disabled={phase !== 'writing' && phase !== 'passed'}
        >
          <span aria-hidden="true">{showMyStrokes ? '✎' : '☰'}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onUndoStroke}
          disabled={phase !== 'writing' || gestureCount === 0}
          aria-label="Undo stroke"
          title="Remove the last pen stroke"
        >
          <span aria-hidden="true">↶</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onClear}
          disabled={phase !== 'writing'}
          aria-label="Clear"
          title="Clear ink"
        >
          <span aria-hidden="true">⌫</span>
        </button>
        <button
          type="button"
          className={`icon-btn${soundEnabled ? ' is-on' : ''}`}
          onClick={onSoundClick}
          onPointerDown={onSoundPointerDown}
          onPointerUp={onSoundPointerUp}
          onPointerCancel={onSoundPointerCancel}
          onPointerLeave={onSoundPointerCancel}
          onContextMenu={(e) => e.preventDefault()}
          aria-pressed={soundEnabled}
          aria-label={
            soundEnabled
              ? 'Tap to hear character. Hold to turn auto sound off.'
              : 'Tap to hear character. Hold to turn auto sound on.'
          }
          title="Tap to hear · hold to toggle auto"
        >
          <span aria-hidden="true">{soundEnabled ? '🔊' : '🔇'}</span>
        </button>
      </div>
      {voiceNote && (
        <p className="trace-voice-note" role="status">
          {voiceNote}
        </p>
      )}

      {((phase === 'passed' && level < levelCount) ||
        nextCharacter !== undefined) && (
        <div className="trace-actions">
          {phase === 'passed' && level < levelCount && (
            <button
              type="button"
              className="btn btn-primary btn-compact"
              onClick={goNextLevel}
              disabled={!isLevelUnlocked(character, level + 1)}
            >
              Next level
            </button>
          )}
          {nextCharacter !== undefined &&
            (nextCharacter ? (
              <Link
                className="btn btn-primary btn-compact next-char-btn"
                to={`/practice/${nextCharacter.id}`}
              >
                Next character · {nextCharacter.character}
              </Link>
            ) : (
              <Link className="btn btn-ghost btn-compact" to="/">
                All caught up
              </Link>
            ))}
        </div>
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
