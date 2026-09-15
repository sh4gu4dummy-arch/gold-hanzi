import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import TracePad, { DEFAULT_ACCENT } from '../components/TracePad'
import { CHARACTERS, getCharacter } from '../data/characters'
import { STROKE_DATA } from '../data/strokeData'
import { getCharProgress } from '../lib/progress'
import type { CharProgress } from '../lib/progress'

export default function Practice() {
  const { id = '' } = useParams()
  const entry = getCharacter(id)

  const levelCount = entry
    ? (STROKE_DATA[entry.character]?.strokes.length ?? 0)
    : 0

  const [progressByChar, setProgressByChar] = useState<Record<string, CharProgress>>(
    {},
  )
  const [finishedChar, setFinishedChar] = useState<string | null>(null)

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

  return (
    <main className="page practice">
      <header className="practice-bar">
        <Link className="back-link" to="/">
          ← Home
        </Link>
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
        key={entry.id}
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
