import HanziWriter from 'hanzi-writer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { charDataLoader } from '../data/strokeData'

export const DEFAULT_ACCENT = '#7C5CBF'

type TracePadProps = {
  character: string
  accent?: string
  onDone: () => void
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

export default function TracePad({
  character,
  accent = DEFAULT_ACCENT,
  onDone,
}: TracePadProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const writerHostRef = useRef<HTMLDivElement>(null)
  const writerRef = useRef<HanziWriter | null>(null)
  const strokeIndexRef = useRef(0)
  const strokeCountRef = useRef(0)
  const sessionRef = useRef(0)

  const [strokeIndex, setStrokeIndex] = useState(0)
  const [strokeCount, setStrokeCount] = useState(0)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [complete, setComplete] = useState(false)

  const syncWriterSize = useCallback(() => {
    const wrap = wrapRef.current
    const writer = writerRef.current
    if (!wrap || !writer) return
    const size = Math.max(1, Math.round(wrap.clientWidth))
    writer.updateDimensions({ width: size, height: size, padding: 24 })
  }, [])

  const beginQuizAt = useCallback(
    (index: number, animate: boolean) => {
      const writer = writerRef.current
      const total = strokeCountRef.current
      if (!writer || total === 0) return

      const clamped = Math.max(0, Math.min(index, total))
      strokeIndexRef.current = clamped
      setStrokeIndex(clamped)
      setComplete(clamped >= total)
      setDone(false)

      if (clamped >= total) {
        writer.cancelQuiz()
        void writer.showCharacter({ duration: 200 })
        return
      }

      void writer
        .quiz({
          quizStartStrokeNum: clamped,
          showHintAfterMisses: 1,
          highlightOnComplete: true,
          acceptBackwardsStrokes: true,
          leniency: 1.2,
          onCorrectStroke: (summary) => {
            const next = summary.strokeNum + 1
            strokeIndexRef.current = next
            setStrokeIndex(next)
            if (next >= total) {
              setComplete(true)
            } else {
              void writer.highlightStroke(next)
            }
          },
          onComplete: () => {
            strokeIndexRef.current = total
            setStrokeIndex(total)
            setComplete(true)
          },
        })
        .then(() => {
          if (animate) {
            void writer.highlightStroke(clamped)
          }
        })
    },
    [],
  )

  useEffect(() => {
    const host = writerHostRef.current
    const wrap = wrapRef.current
    if (!host || !wrap) return

    const session = ++sessionRef.current
    setReady(false)
    setLoadError(null)
    setStrokeIndex(0)
    setStrokeCount(0)
    setDone(false)
    setComplete(false)
    strokeIndexRef.current = 0
    strokeCountRef.current = 0

    host.replaceChildren()

    const size = Math.max(1, Math.round(wrap.clientWidth))
    const writer = HanziWriter.create(host, character, {
      width: size,
      height: size,
      padding: 24,
      showOutline: true,
      showCharacter: false,
      strokeColor: accent,
      radicalColor: accent,
      outlineColor: lighten(accent, 110),
      highlightColor: accent,
      drawingColor: accent,
      strokeHighlightSpeed: 1.2,
      strokeAnimationSpeed: 1.1,
      strokeFadeDuration: 120,
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

    void writer
      .getCharacterData()
      .then((data) => {
        if (sessionRef.current !== session) return
        const total = data.strokes.length
        strokeCountRef.current = total
        setStrokeCount(total)
        setReady(true)
        beginQuizAt(0, true)
      })
      .catch(() => {
        if (sessionRef.current === session) {
          setLoadError('Could not load stroke-order data for this character.')
        }
      })

    return () => {
      sessionRef.current += 1
      writer.cancelQuiz()
      writerRef.current = null
      host.replaceChildren()
    }
  }, [character, accent, beginQuizAt])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => syncWriterSize())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [syncWriterSize])

  const nextStroke = () => {
    if (!ready || done || complete) return
    const writer = writerRef.current
    const total = strokeCountRef.current
    if (!writer || total === 0) return

    writer.skipQuizStroke()
    const next = strokeIndexRef.current + 1
    strokeIndexRef.current = next
    setStrokeIndex(next)
    if (next >= total) {
      setComplete(true)
    } else {
      void writer.highlightStroke(next)
    }
  }

  const prevStroke = () => {
    if (!ready || done || strokeIndexRef.current <= 0) return
    beginQuizAt(strokeIndexRef.current - 1, true)
  }

  const replayStroke = () => {
    if (!ready || done || complete) return
    const writer = writerRef.current
    if (!writer) return
    void writer.highlightStroke(strokeIndexRef.current)
  }

  const clearInk = () => {
    if (!ready || done) return
    // Restart quiz at the same stroke to wipe user drawings.
    beginQuizAt(strokeIndexRef.current, false)
  }

  const finish = () => {
    if (done) return
    if (!complete && strokeIndexRef.current < strokeCountRef.current - 1) return
    const writer = writerRef.current
    writer?.cancelQuiz()
    void writer?.showCharacter({ duration: 200 })
    setDone(true)
    setComplete(true)
    onDone()
  }

  const onLastStroke = strokeCount > 0 && strokeIndex >= strokeCount - 1
  const canFinish = !done && (complete || onLastStroke)
  const progressLabel =
    strokeCount === 0
      ? 'Loading strokes…'
      : complete
        ? `Complete · ${strokeCount} strokes`
        : `Stroke ${strokeIndex + 1} of ${strokeCount}`

  return (
    <div className="trace-pad">
      <div className="stroke-progress" aria-live="polite">
        <span className="stroke-progress-label">{progressLabel}</span>
        {strokeCount > 0 && (
          <div
            className="stroke-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={strokeCount}
            aria-valuenow={Math.min(strokeIndex + (complete ? 0 : 1), strokeCount)}
            aria-label={progressLabel}
          >
            <span
              className="stroke-progress-fill"
              style={{
                width: `${(Math.min(strokeIndex, strokeCount) / strokeCount) * 100}%`,
                background: accent,
              }}
            />
          </div>
        )}
      </div>

      <div
        ref={wrapRef}
        className={`trace-stage${done ? ' is-done' : ''}`}
        style={{ ['--accent' as string]: accent }}
      >
        <div className="tianzige" aria-hidden="true">
          <span className="tianzige-h" />
          <span className="tianzige-v" />
          <span className="tianzige-d1" />
          <span className="tianzige-d2" />
        </div>
        <div
          ref={writerHostRef}
          className="hanzi-host hanzi-host-interactive"
          aria-label={`Trace stroke ${Math.min(strokeIndex + 1, Math.max(strokeCount, 1))} of character ${character}`}
        />
        {loadError && (
          <div className="trace-error" role="alert">
            {loadError}
          </div>
        )}
        {done && (
          <div className="trace-success" role="status">
            <span className="trace-check">✓</span>
            <span>Nice work</span>
          </div>
        )}
      </div>

      <div className="trace-actions trace-actions-guide">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={prevStroke}
          disabled={!ready || done || strokeIndex <= 0}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={replayStroke}
          disabled={!ready || done || complete}
        >
          Replay
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={nextStroke}
          disabled={!ready || done || complete}
        >
          Next stroke
        </button>
      </div>

      <div className="trace-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={clearInk}
          disabled={!ready || done || complete}
        >
          Clear
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={finish}
          disabled={!canFinish}
        >
          {done ? 'Finished' : 'Done'}
        </button>
      </div>

      <p className="trace-hint">
        Watch the highlighted stroke, then draw it on the pad (or tap{' '}
        <strong>Next stroke</strong>). <strong>Replay</strong> shows it again;{' '}
        <strong>Clear</strong> wipes your attempt.
      </p>
    </div>
  )
}
