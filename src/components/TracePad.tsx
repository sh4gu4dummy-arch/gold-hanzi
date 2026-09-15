import { useCallback, useEffect, useRef, useState } from 'react'

export const DEFAULT_ACCENT = '#7C5CBF'

type Point = { x: number; y: number }

type TracePadProps = {
  character: string
  accent?: string
  onDone: () => void
}

function pointerToCanvas(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
): Point {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

export default function TracePad({
  character,
  accent = DEFAULT_ACCENT,
  onDone,
}: TracePadProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<Point | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [done, setDone] = useState(false)

  const syncCanvasSize = useCallback(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const dpr = window.devicePixelRatio || 1
    const size = wrap.clientWidth
    const nextW = Math.max(1, Math.round(size * dpr))
    const nextH = Math.max(1, Math.round(size * dpr))
    if (canvas.width === nextW && canvas.height === nextH) return

    const snapshot = document.createElement('canvas')
    snapshot.width = canvas.width
    snapshot.height = canvas.height
    const snapCtx = snapshot.getContext('2d')
    if (snapCtx && canvas.width > 0 && canvas.height > 0) {
      snapCtx.drawImage(canvas, 0, 0)
    }

    canvas.width = nextW
    canvas.height = nextH
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`

    const ctx = canvas.getContext('2d')
    if (ctx && snapshot.width > 0) {
      ctx.drawImage(snapshot, 0, 0, nextW, nextH)
    }
  }, [])

  useEffect(() => {
    syncCanvasSize()
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => syncCanvasSize())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [syncCanvasSize])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      event.preventDefault()
      canvas.setPointerCapture(event.pointerId)
      drawingRef.current = true
      lastRef.current = pointerToCanvas(event, canvas)
    }

    const onMove = (event: PointerEvent) => {
      if (!drawingRef.current) return
      const next = pointerToCanvas(event, canvas)
      const prev = lastRef.current
      if (!prev) {
        lastRef.current = next
        return
      }

      const dpr = canvas.width / canvas.getBoundingClientRect().width
      ctx.strokeStyle = accent
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(8, 14 * dpr)
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(next.x, next.y)
      ctx.stroke()

      lastRef.current = next
      setHasInk(true)
    }

    const onUp = (event: PointerEvent) => {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
      drawingRef.current = false
      lastRef.current = null
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
  }, [accent])

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    drawingRef.current = false
    lastRef.current = null
    setHasInk(false)
    setDone(false)
  }

  const finish = () => {
    if (!hasInk || done) return
    setDone(true)
    onDone()
  }

  return (
    <div className="trace-pad">
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
        <div className="trace-guide" aria-hidden="true">
          {character}
        </div>
        <canvas
          ref={canvasRef}
          className="trace-canvas"
          aria-label={`Trace the character ${character}`}
        />
        {done && (
          <div className="trace-success" role="status">
            <span className="trace-check">✓</span>
            <span>Nice work</span>
          </div>
        )}
      </div>

      <div className="trace-actions">
        <button type="button" className="btn btn-ghost" onClick={clear}>
          Clear
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={finish}
          disabled={!hasInk || done}
        >
          {done ? 'Finished' : 'Done'}
        </button>
      </div>
    </div>
  )
}
