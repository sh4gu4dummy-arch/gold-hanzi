import HanziWriter from 'hanzi-writer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { STROKE_DATA, charDataLoader } from '../data/strokeData'
import {
  HANZI_PADDING,
  applyHanziTransform,
  buildLetterMask,
  clearInk,
  describeGradeNeeds,
  evaluateGrade,
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

/** Draw stroke-path guides (same transform as grading mask / hanzi-writer). */
function drawStrokeGuides(
  ctx: CanvasRenderingContext2D,
  cssSize: number,
  dpr: number,
  strokePaths: string[],
  fromStroke: number,
  accent: string,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssSize, cssSize)
  if (fromStroke >= strokePaths.length) return

  ctx.save()
  applyHanziTransform(ctx, cssSize)
  ctx.fillStyle = hexToRgba(accent, 0.22)
  for (let i = fromStroke; i < strokePaths.length; i++) {
    try {
      const path = new Path2D(strokePaths[i]!)
      ctx.fill(path)
    } catch {
      // Ignore malformed path segments.
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
    liveGrade != null ? describeGradeNeeds(liveGrade) : 'need cover'

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
            Nice work — level beaten by the three-gate grader (cover, regions,
            strokes). Tap a pip to review your drawing, or Replay guide to
            practice again.
          </>
        ) : phase === 'demo' ? (
          <>Watch the stroke order, or tap Skip guide to start tracing.</>
        ) : (
          <>
            {memoryHint} Pass when the app grades cover + regions + strokes —
            no Done button needed.
          </>
        )}
      </p>
    </div>
  )
}
