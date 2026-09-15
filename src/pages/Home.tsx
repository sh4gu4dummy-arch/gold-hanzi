import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import { CHARACTERS } from '../data/characters'
import { STROKE_DATA } from '../data/strokeData'
import {
  beatenCount,
  clearAllProgress,
  clearCharProgress,
} from '../lib/progress'

export default function Home() {
  const [revision, setRevision] = useState(0)

  const bumpRevision = () => setRevision((n) => n + 1)

  const handleWipeAll = () => {
    const ok = window.confirm(
      'Wipe all progress? This resets every character and cannot be undone.',
    )
    if (!ok) return
    clearAllProgress()
    bumpRevision()
  }

  const handleWipeChar = (
    event: MouseEvent,
    character: string,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const ok = window.confirm(
      `Wipe progress for ${character}? This cannot be undone.`,
    )
    if (!ok) return
    clearCharProgress(character)
    bumpRevision()
  }

  return (
    <main className="page home">
      <header className="home-header">
        <div className="home-header-top">
          <p className="eyebrow">描红练习</p>
          <ThemeToggle />
        </div>
        <h1>汉字描红</h1>
        <p className="lede">
          Trace the 10 most common Simplified Chinese characters. Each character
          has one level per stroke — beat them with the three-gate grader.
        </p>
        <div className="home-wipe-all">
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleWipeAll}
          >
            Wipe all progress
          </button>
        </div>
      </header>

      <ol className="char-grid" key={revision}>
        {CHARACTERS.map((entry, index) => {
          const strokes = STROKE_DATA[entry.character]?.strokes.length ?? 0
          const cleared = beatenCount(entry.character)
          return (
            <li key={entry.id} className="char-tile-wrap">
              <Link
                className="char-tile"
                to={`/practice/${entry.id}`}
                aria-label={`Practice ${entry.character}, ${entry.pinyin}, ${entry.meaning}. ${cleared} of ${strokes} levels cleared.`}
              >
                <span className="char-rank">{index + 1}</span>
                <span className="char-glyph">{entry.character}</span>
                <span className="char-pinyin">{entry.pinyin}</span>
                <span className="char-meaning">{entry.meaning}</span>
                {strokes > 0 && (
                  <span className="char-levels" aria-hidden="true">
                    {Array.from({ length: strokes }, (_, i) => (
                      <span
                        key={i}
                        className={`char-level-dot${i < cleared ? ' is-on' : ''}`}
                      />
                    ))}
                  </span>
                )}
              </Link>
              <button
                type="button"
                className="char-wipe"
                aria-label={`Wipe progress for ${entry.character}`}
                onClick={(e) => handleWipeChar(e, entry.character)}
              >
                Wipe
              </button>
            </li>
          )
        })}
      </ol>
    </main>
  )
}
