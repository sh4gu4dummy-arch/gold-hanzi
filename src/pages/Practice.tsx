import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import TracePad, { DEFAULT_ACCENT } from '../components/TracePad'
import { CHARACTERS, getCharacter } from '../data/characters'

export default function Practice() {
  const { id = '' } = useParams()
  const entry = getCharacter(id)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    setFinished(false)
  }, [id])

  const next = useMemo(() => {
    if (!entry) return undefined
    const index = CHARACTERS.findIndex((item) => item.id === entry.id)
    return CHARACTERS[(index + 1) % CHARACTERS.length]
  }, [entry])

  if (!entry) {
    return <Navigate to="/" replace />
  }

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
          <p>{entry.meaning}</p>
        </div>
      </header>

      <TracePad
        key={entry.id}
        character={entry.character}
        accent={DEFAULT_ACCENT}
        onDone={() => setFinished(true)}
      />

      {finished && next && (
        <p className="next-hint">
          Next up:{' '}
          <Link to={`/practice/${next.id}`}>
            {next.character} {next.pinyin}
          </Link>
        </p>
      )}
    </main>
  )
}
