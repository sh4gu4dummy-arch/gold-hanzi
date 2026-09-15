import { Link } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import { CHARACTERS } from '../data/characters'
import { STROKE_DATA } from '../data/strokeData'
import { beatenCount } from '../lib/progress'

export default function Home() {
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
      </header>

      <ol className="char-grid">
        {CHARACTERS.map((entry, index) => {
          const strokes = STROKE_DATA[entry.character]?.strokes.length ?? 0
          const cleared = beatenCount(entry.character)
          return (
            <li key={entry.id}>
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
            </li>
          )
        })}
      </ol>
    </main>
  )
}
