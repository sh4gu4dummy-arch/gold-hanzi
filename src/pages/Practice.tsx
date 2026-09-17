import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import TracePad, { DEFAULT_ACCENT } from '../components/TracePad'
import { CHARACTERS, getCharacter } from '../data/characters'
import { STROKE_DATA } from '../data/strokeData'
import { clearCharProgress, getCharProgress } from '../lib/progress'
import type { CharProgress } from '../lib/progress'
import { APP_VERSION } from '../version'

export default function Practice() {
  const { id = '' } = useParams()
  const entry = getCharacter(id)

  const levelCount = entry
    ? (STROKE_DATA[entry.character]?.strokes.length ?? 0)
    : 0

  const [progressByChar, setProgressByChar] = useState<
    Record<string, CharProgress>
  >({})
  const [finishedChar, setFinishedChar] = useState<string | null>(null)
  const [padRevision, setPadRevision] = useState(0)

  const progress: CharProgress = entry
    ? (progressByChar[entry.character] ?? getCharProgress(entry.character))
    : { beaten: [] }

  const next = useMemo(() => {
    if (!entry) return undefined
    const index = CHARACTERS.findIndex((item) => item.id === entry.id)
    return CHARACTERS[(index + 1) % CHARACTERS.length]
  }, [entry])

  if (!entry) {
    return <Navigate to="/" replace />
  }

  const cleared = progress.beaten.length
  const finished = finishedChar === entry.character

  const handleWipeChar = () => {
    const ok = window.confirm(
      `Wipe progress for ${entry.character}? This cannot be undone.`,
    )
    if (!ok) return
    clearCharProgress(entry.character)
    setProgressByChar((prev) => ({
      ...prev,
      [entry.character]: { beaten: [], inkByLevel: {} },
    }))
    setFinishedChar(null)
    setPadRevision((n) => n + 1)
  }

  return (
    <main className="page practice">
      <header className="practice-bar">
        <div className="practice-bar-top">
          <Link className="back-link" to="/">
            ← Home
          </Link>
          <div className="practice-bar-actions">
            <span className="app-version" aria-label={`App version ${APP_VERSION}`}>
              {APP_VERSION}
            </span>
            <ThemeToggle />
          </div>
        </div>
        <div className="practice-meta">
          <h1>
            <span className="practice-glyph">{entry.character}</span>
            <span className="practice-pinyin">{entry.pinyin}</span>
          </h1>
          <p>
            {entry.meaning}
            {levelCount > 0 && (
              <>
                {' '}
                · {cleared}/{levelCount} levels
              </>
            )}
          </p>
        </div>
      </header>

      <TracePad
        key={`${entry.id}-${padRevision}`}
        character={entry.character}
        accent={DEFAULT_ACCENT}
        onDone={() => setFinishedChar(entry.character)}
        onProgressChange={(nextProgress) =>
          setProgressByChar((prev) => ({
            ...prev,
            [entry.character]: nextProgress,
          }))
        }
      />

      <div className="practice-wipe-row">
        <button
          type="button"
          className="link-danger"
          onClick={handleWipeChar}
        >
          Wipe this character’s progress
        </button>
      </div>

      {finished &&
        next &&
        progress.beaten.length >= levelCount &&
        levelCount > 0 && (
          <p className="next-hint">
            All levels cleared! Next up:{' '}
            <Link to={`/practice/${next.id}`}>
              {next.character} {next.pinyin}
            </Link>
          </p>
        )}
    </main>
  )
}
