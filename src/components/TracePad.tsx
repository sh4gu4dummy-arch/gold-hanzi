import HanziWriter from 'hanzi-writer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { STROKE_DATA, charDataLoader } from '../data/strokeData'
import {
  HANZI_PADDING,
  applyHanziTransform,
  buildLetterMask,
  clearInk,
  contentCenterFromMedians,
  describeGradeNeeds,
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

export const DEFAULT_ACCENT = '#7C5CBF'

/** ~2× slower than hanzi-writer defaults (speed 1). */
const GUIDE_ANIM_SPEED = 0.45
const GUIDE_HIGHLIGHT_SPEED = 0.5
const AUTO_ADVANCE_MS = 1000

type TracePadProps = {
  character: string
  accent?: string
  onDone?: () => void
  onProgressChange?: (progress: CharProgress, levelCount: number) => void
}

type Phase = 'loading' | 'demo' | 'writing' | 'passed'

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

/** Small chevron along the early median tangent (hanzi y-up). */
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
  const gap = u * 0.28
  const len = u * 1.08
  const head = u * 0.44
  const ax = ox + tx * gap
  const ay = oy + ty * gap
  const tipx = ax + tx * len
  const tipy = ay + ty * len
  const bx = -ty
  const by = tx

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1.35 / scale, u * 0.13)
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(tipx, tipy)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(tipx, tipy)
  ctx.lineTo(
    tipx - tx * head + bx * head * 0.46,
    tipy - ty * head + by * head * 0.46,
  )
  ctx.lineTo(
    tipx - tx * head - bx * head * 0.46,
    tipy - ty * head - by * head * 0.46,
  )
  ctx.closePath()
  ctx.fill()
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
 * Markers follow the same fromStroke hide rule as the underlay; numbers
 * are the true stroke index 1…n (not renumbered among visible strokes).
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
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssSize, cssSize)
  if (fromStroke >= strokePaths.length) return

  const { u, scale } = markerSizeHanzi(cssSize)
  const markerFill = hexToRgba(accent, 0.92)

  const contentCenter = contentCenterFromMedians(medians)

  ctx.save()
  applyHanziTransform(ctx, cssSize, contentCenter)
  ctx.fillStyle = hexToRgba(accent, 0.22)
  for (let i = fromStroke; i < strokePaths.length; i++) {
    try {
      const path = new Path2D(strokePaths[i]!)
      ctx.fill(path)
    } catch {
      // Ignore malformed path segments.
    }
  }

  const markers = layoutGuideMarkers(medians, fromStroke, u)
  for (const m of markers) {
    const ox = m.ox + m.offx
    const oy = m.oy + m.offy
    if (m.hasTangent) {
      drawGuideArrow(ctx, ox, oy, m.tx, m.ty, m.u, scale, accent)
    }
    drawGuideNumber(
      ctx,
      m.nx,
      m.ny,
      m.u,
      scale,
      m.strokeIndex + 1,
      markerFill,
      accent,
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

export default function TracePad({
  character,
  accent = DEFAULT_ACCENT,
  onDone,
  onProgressChange,
}: TracePadProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const writerHostRef = useRef<HTMLDivElement>(null)
  const guideCanvasRef = useRef<HTMLCanvasElement>(null)
  const inkCanvasRef = useRef<HTMLCanvasElement>(null)

  const writerRef = useRef<HanziWriter | null>(null)
  const maskRef = useRef<LetterMask | null>(null)
  const sessionRef = useRef(0)
  const drawingRef = useRef(false)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)
  const doneRef = useRef(false)
  const levelRef = useRef(1)
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const levelCountRef = useRef(0)

  const strokeData = STROKE_DATA[character]
  const levelCount = strokeData?.strokes.length ?? 0
  levelCountRef.current = levelCount

  const [progress, setProgress] = useState<CharProgress>(() =>
    getCharProgress(character),
  )
  const [level, setLevel] = useState(1)
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [liveGrade, setLiveGrade] = useState<GradeStatus | null>(null)

  levelRef.current = level

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

  const resizeCanvases = useCallback(() => {
    const wrap = wrapRef.current
    const guide = guideCanvasRef.current
    const ink = inkCanvasRef.current
    if (!wrap || !guide || !ink) return
    const cssSize = stageCssSize()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    for (const canvas of [guide, ink]) {
      canvas.width = Math.round(cssSize * dpr)
      canvas.height = Math.round(cssSize * dpr)
      // Fill the square stage; CSS absolute inset centers via host layout.
      canvas.style.width = '100%'
      canvas.style.height = '100%'
    }
    return { cssSize, dpr }
  }, [])

  const paintGuide = useCallback(
    (levelNum: number) => {
      const guide = guideCanvasRef.current
      const wrap = wrapRef.current
      if (!guide || !wrap || !strokeData) return
      const cssSize = stageCssSize()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const ctx = guide.getContext('2d')
      if (!ctx) return

      // Level 1: all strokes faint. Level k>1: hide strokes 0..(k-2).
      const fromStroke = levelNum <= 1 ? 0 : levelNum - 1
      drawStrokeGuides(
        ctx,
        cssSize,
        dpr,
        strokeData.strokes,
        strokeData.medians,
        fromStroke,
        accent,
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

  const clearInkCanvas = useCallback(() => {
    const ink = inkCanvasRef.current
    if (!ink) return
    const ctx = ink.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, ink.width, ink.height)
    if (maskRef.current) {
      clearInk(maskRef.current)
      setLiveGrade(evaluateGrade(maskRef.current))
    } else {
      setLiveGrade(null)
    }
  }, [])

  const hideWriterHost = useCallback(() => {
    const host = writerHostRef.current
    if (host) {
      host.style.opacity = '0'
      host.style.pointerEvents = 'none'
    }
  }, [])

  const restoreInkFromDataUrl = useCallback(
    (dataUrl: string, session: number) => {
      const ink = inkCanvasRef.current
      if (!ink || !dataUrl) return
      const ctx = ink.getContext('2d')
      if (!ctx) return
      const img = new Image()
      img.onload = () => {
        if (sessionRef.current !== session) return
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, ink.width, ink.height)
        ctx.drawImage(img, 0, 0, ink.width, ink.height)
      }
      img.src = dataUrl
    },
    [],
  )

  /** Review a beaten level: saved ink, no guide, phase passed. */
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

      hideWriterHost()
      clearGuideCanvas(guideCanvasRef.current)
      resizeCanvases()
      clearInkCanvas()

      const dataUrl = getLevelInk(character, levelNum)
      if (dataUrl) {
        restoreInkFromDataUrl(dataUrl, session)
      }
    },
    [
      character,
      clearAutoAdvance,
      clearInkCanvas,
      hideWriterHost,
      resizeCanvases,
      restoreInkFromDataUrl,
    ],
  )

  const enterWritingAfterDemo = useCallback(
    async (levelNum: number, session: number) => {
      hideWriterHost()
      paintGuide(levelNum)
      await rebuildMask()
      if (sessionRef.current !== session) return
      const mask = maskRef.current
      setLiveGrade(mask ? evaluateGrade(mask) : null)
      setPhase('writing')
    },
    [hideWriterHost, paintGuide, rebuildMask],
  )

  const finishPass = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    setPhase('passed')

    let inkDataUrl: string | undefined
    try {
      inkDataUrl = inkCanvasRef.current?.toDataURL('image/png') ?? undefined
    } catch {
      inkDataUrl = undefined
    }

    const beaten = markLevelBeaten(character, levelRef.current, inkDataUrl)
    notifyProgress(beaten)
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
    notifyProgress,
    onDone,
  ])

  const checkGrade = useCallback(() => {
    const mask = maskRef.current
    if (!mask || doneRef.current) return
    const status = evaluateGrade(mask)
    setLiveGrade(status)
    if (status.pass) {
      finishPass()
    }
  }, [finishPass])

  const runDemoThenWrite = useCallback(
    async (levelNum: number) => {
      const session = sessionRef.current
      const writer = writerRef.current
      const host = writerHostRef.current
      if (!writer || !host || !strokeData) return

      clearAutoAdvance()
      doneRef.current = false
      setPhase('demo')
      setLiveGrade(null)
      setLoadError(null)

      resizeCanvases()
      clearInkCanvas()
      clearGuideCanvas(guideCanvasRef.current)

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
      setLoadError('Could not load stroke-order data for this character.')
      setPhase('loading')
      return
    }

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

  // Resize observer: rebuild canvases + mask while writing.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => {
      const writer = writerRef.current
      const size = stageCssSize()
      writer?.updateDimensions({
        width: size,
        height: size,
        padding: HANZI_PADDING,
      })
      resizeCanvases()
      if (phase === 'writing' && !doneRef.current) {
        paintGuide(levelRef.current)
        void rebuildMask().then(() => clearInkCanvas())
      } else if (phase === 'passed') {
        // Keep review ink visible; re-stretch saved snapshot if present.
        const dataUrl = getLevelInk(character, levelRef.current)
        if (dataUrl) {
          restoreInkFromDataUrl(dataUrl, sessionRef.current)
        }
      }
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [
    phase,
    character,
    paintGuide,
    rebuildMask,
    resizeCanvases,
    clearInkCanvas,
    restoreInkFromDataUrl,
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

  const goNextLevel = () => {
    clearAutoAdvance()
    selectLevel(level + 1)
  }

  // Pointer drawing on ink canvas.
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

    const onDown = (e: PointerEvent) => {
      if (phase !== 'writing' || doneRef.current) return
      e.preventDefault()
      canvas.setPointerCapture(e.pointerId)
      drawingRef.current = true
      const pt = getPos(e)
      lastPtRef.current = pt
      const ctx = canvas.getContext('2d')
      const mask = maskRef.current
      if (!ctx || !mask) return
      const dpr = mask.dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = accent
      ctx.fillStyle = accent
      const inkW = inkWidthCss()
      ctx.lineWidth = inkW
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, inkW / 2, 0, Math.PI * 2)
      ctx.fill()
      stampInkSegment(mask, pt.x, pt.y, pt.x, pt.y)
      checkGrade()
    }

    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current || phase !== 'writing' || doneRef.current) return
      e.preventDefault()
      const pt = getPos(e)
      const prev = lastPtRef.current ?? pt
      lastPtRef.current = pt
      const ctx = canvas.getContext('2d')
      const mask = maskRef.current
      if (!ctx || !mask) return
      const dpr = mask.dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = accent
      ctx.lineWidth = inkWidthCss()
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(pt.x, pt.y)
      ctx.stroke()
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
  }, [accent, phase, checkGrade])

  const beatenSet = new Set(progress.beaten)
  const levelLabel =
    levelCount === 0
      ? 'Levels · Loading…'
      : phase === 'demo'
        ? `Levels · Level ${level} · watch the guide`
        : phase === 'passed'
          ? `Levels · Level ${level} cleared!`
          : `Levels · Level ${level} of ${levelCount}`

  const coverPct =
    liveGrade != null ? Math.round(liveGrade.cover * 100) : 0
  const gradeNeeds =
    liveGrade != null ? describeGradeNeeds(liveGrade) : 'follow the stroke'

  const memoryHint =
    level <= 1
      ? 'Full guide visible — trace the whole character.'
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

      {phase === 'writing' && (
        <div
          className={`grade-meter${liveGrade?.pass ? ' is-ok' : ''}`}
          aria-live="polite"
          aria-label={`This attempt: ${coverPct} percent cover. ${gradeNeeds}`}
        >
          <span className="grade-meter-cover">
            This attempt: {coverPct}% cover
          </span>
          <span className="grade-meter-gates"> · {gradeNeeds}</span>
        </div>
      )}

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
        {phase === 'demo' && (
          <div className="trace-demo-badge" role="status">
            Watch…
          </div>
        )}
      </div>
      </div>

      <div
        className="level-pips"
        role="list"
        aria-label={`Levels beaten: ${beatenSet.size} of ${levelCount}`}
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
                    ? `Level ${L} (beaten) — tap to review`
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

      <div className="trace-actions">
        {phase === 'demo' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={skipGuide}
            disabled={!!loadError}
          >
            Skip guide
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={replayGuide}
            disabled={phase === 'loading' || !!loadError}
          >
            Replay guide
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onClear}
          disabled={phase !== 'writing'}
        >
          Clear
        </button>
        {phase === 'passed' && level < levelCount && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={goNextLevel}
            disabled={!isLevelUnlocked(character, level + 1)}
          >
            Next level
          </button>
        )}
      </div>

      <p className="trace-hint">
        {phase === 'passed' ? (
          <>
            Nice work — you followed and finished each stroke. Tap a pip to
            review your drawing, or Replay guide to practice again.
          </>
        ) : phase === 'demo' ? (
          <>Watch the stroke order, or tap Skip guide to start tracing.</>
        ) : (
          <>
            {memoryHint} Pass when you follow each stroke to the end — no Done
            button needed.
          </>
        )}
      </p>
    </div>
  )
}
