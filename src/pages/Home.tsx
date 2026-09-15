import { Link } from 'react-router-dom'
import { CHARACTERS } from '../data/characters'

export default function Home() {
  return (
    <main className="page home">
      <header className="home-header">
        <p className="eyebrow">描红练习</p>
        <h1>汉字描红</h1>
        <p className="lede">
          Trace the 10 most common Simplified Chinese characters. Tap a tile to
          begin.
        </p>
      </header>

      <ol className="char-grid">
        {CHARACTERS.map((entry, index) => (
          <li key={entry.id}>
            <Link
              className="char-tile"
              to={`/practice/${entry.id}`}
              aria-label={`Practice ${entry.character}, ${entry.pinyin}, ${entry.meaning}`}
            >
              <span className="char-rank">{index + 1}</span>
              <span className="char-glyph">{entry.character}</span>
              <span className="char-pinyin">{entry.pinyin}</span>
              <span className="char-meaning">{entry.meaning}</span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  )
}
