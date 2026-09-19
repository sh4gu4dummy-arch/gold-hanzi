import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import { CHARACTERS } from '../data/characters'
import type { CharacterEntry } from '../data/characters'
import { ensureBandLoaded } from '../data/strokeData'
import {
  bandProgress,
  buildBands,
  entriesForView,
  isCharacterUnlocked,
  lessonBandProgress,
  strokeLevelCount,
} from '../lib/homeCatalog'
import {
  getDifficultyMode,
  getHskView,
  setDifficultyMode,
  setHskView,
} from '../lib/homePref'
import type { DifficultyMode, HskView } from '../lib/homePref'
import { beatenCount, clearAllProgress } from '../lib/progress'
import { APP_VERSION } from '../version'

export default function Home() {
  const [revision, setRevision] = useState(0)
  const [hskView, setHskViewState] = useState<HskView>(() => getHskView())
  const [difficulty, setDifficultyState] = useState<DifficultyMode>(() =>
    getDifficultyMode(),
  )
  /** null = default first band; -1 = all bands collapsed */
  const [openBand, setOpenBand] = useState<number | null>(null)
  /** Independently open lessons (manual minimize; opening one does not close others). */
  const [openLessons, setOpenLessons] = useState<Set<string>>(() => new Set())

  const bands = useMemo(
    () => buildBands(CHARACTERS, hskView),
    [hskView, revision],
  )
  const ordered = useMemo(
    () => entriesForView(CHARACTERS, hskView),
    [hskView, revision],
  )

  const resolvedBand =
    openBand === -1 ? null : (openBand ?? bands[0]?.level ?? null)

  // When the HSK view / band set changes, open the first lesson of the default band once.
  useEffect(() => {
    const nextBands = buildBands(CHARACTERS, hskView)
    const first = nextBands[0]?.lessons[0]?.id
    if (!first) {
      setOpenLessons(new Set())
      return
    }
    setOpenLessons(new Set([first]))
    setOpenBand(null)
  }, [hskView, revision])

  // Warm stroke geometry for the open band (classic HSK modules).
  useEffect(() => {
    if (resolvedBand == null) return
    const band = bands.find((b) => b.level === resolvedBand)
    if (!band) return
    const classic = new Set<number>()
    for (const e of band.entries) {
      if (e.hskClassic != null) classic.add(e.hskClassic)
    }
    // Classic view: band level itself is the module key.
    if (hskView === 'classic') classic.add(resolvedBand)
    for (const level of classic) {
      void ensureBandLoaded(level)
    }
  }, [resolvedBand, bands, hskView])

  const handleWipeAll = () => {
    const ok = window.confirm(
      'Wipe all progress? This resets every character and cannot be undone.',
    )
    if (!ok) return
    clearAllProgress()
    setRevision((n) => n + 1)
  }

  const onHskView = (view: HskView) => {
    setHskView(view)
    setHskViewState(view)
  }

  const onDifficulty = (mode: DifficultyMode) => {
    setDifficultyMode(mode)
    setDifficultyState(mode)
  }

  const toggleBand = (level: number) => {
    setOpenBand((cur) => {
      const current = cur ?? bands[0]?.level
      if (current === level) return -1
      return level
    })
  }

  const toggleLesson = (lessonId: string) => {
    setOpenLessons((prev) => {
      const next = new Set(prev)
      if (next.has(lessonId)) next.delete(lessonId)
      else next.add(lessonId)
      return next
    })
  }

  return (
    <main className="page home">
      <header className="home-header home-header-sticky">
        <div className="home-header-top">
          <div className="home-title-row">
            <h1>Gold Tracing</h1>
            <span
              className="app-version"
              aria-label={`App version ${APP_VERSION}`}
            >
              {APP_VERSION}
            </span>
          </div>
          <ThemeToggle />
        </div>
        <p className="lede home-lede">
          Trace Simplified characters by HSK band — one practice level per
          stroke. Mobile-first; 12 characters per lesson.
        </p>

        <div className="home-toggles" role="group" aria-label="Home options">
          <div className="home-seg" role="group" aria-label="HSK syllabus">
            <button
              type="button"
              className={`home-seg-btn${hskView === 'classic' ? ' is-on' : ''}`}
              aria-pressed={hskView === 'classic'}
              onClick={() => onHskView('classic')}
            >
              HSK 1–6
            </button>
            <button
              type="button"
              className={`home-seg-btn${hskView === 'v3' ? ' is-on' : ''}`}
              aria-pressed={hskView === 'v3'}
              onClick={() => onHskView('v3')}
            >
              HSK 3.0
            </button>
          </div>
          <div className="home-seg" role="group" aria-label="Difficulty">
            <button
              type="button"
              className={`home-seg-btn${difficulty === 'strict' ? ' is-on' : ''}`}
              aria-pressed={difficulty === 'strict'}
              onClick={() => onDifficulty('strict')}
            >
              Strict
            </button>
            <button
              type="button"
              className={`home-seg-btn${difficulty === 'dev' ? ' is-on' : ''}`}
              aria-pressed={difficulty === 'dev'}
              onClick={() => onDifficulty('dev')}
            >
              Dev unlocked
            </button>
          </div>
        </div>

        <div className="home-wipe-all">
          <button type="button" className="link-danger" onClick={handleWipeAll}>
            Wipe all progress
          </button>
        </div>
      </header>

      <div className="home-bands" key={`${hskView}-${revision}`}>
        {bands.length === 0 && (
          <p className="home-empty">No characters in this HSK view yet.</p>
        )}
        {bands.map((band) => {
          const expanded = resolvedBand === band.level
          const prog = bandProgress(band.entries)
          const lessonProg = lessonBandProgress(band.lessons)
          return (
            <section
              key={band.level}
              className={`hsk-band${expanded ? ' is-open' : ''}`}
            >
              <button
                type="button"
                className="hsk-band-head"
                aria-expanded={expanded}
                onClick={() => toggleBand(band.level)}
              >
                <span className="hsk-band-title">{band.label}</span>
                <span className="hsk-band-meta">
                  {prog.cleared}/{prog.total} chars · {lessonProg.cleared}/
                  {lessonProg.total} lessons
                </span>
                <span className="hsk-band-chev" aria-hidden="true">
                  {expanded ? '▾' : '▸'}
                </span>
              </button>
              {expanded && (
                <div className="hsk-band-body">
                  {band.lessons.map((lesson) => {
                    const lessonOpen = openLessons.has(lesson.id)
                    const lessonProg = bandProgress(lesson.entries)
                    return (
                      <div
                        key={lesson.id}
                        className={`hsk-lesson${lessonOpen ? ' is-open' : ''}`}
                      >
                        <button
                          type="button"
                          className="hsk-lesson-head"
                          aria-expanded={lessonOpen}
                          onClick={() => toggleLesson(lesson.id)}
                        >
                          <span>{lesson.label}</span>
                          <span className="hsk-lesson-meta">
                            {lessonProg.cleared}/{lesson.entries.length} ·{' '}
                            {lesson.entries.length} chars
                          </span>
                          <span aria-hidden="true">
                            {lessonOpen ? '▾' : '▸'}
                          </span>
                        </button>
                        {lessonOpen && (
                          <ol className="char-grid char-grid-compact">
                            {lesson.entries.map((entry) => (
                              <CharTile
                                key={entry.id}
                                entry={entry}
                                hskView={hskView}
                                unlocked={isCharacterUnlocked(
                                  entry,
                                  ordered,
                                  difficulty,
                                )}
                              />
                            ))}
                          </ol>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </main>
  )
}

function CharTile({
  entry,
  hskView,
  unlocked,
}: {
  entry: CharacterEntry
  hskView: HskView
  unlocked: boolean
}) {
  const strokes = strokeLevelCount(entry.character)
  const cleared = beatenCount(entry.character)
  const badge = hskView === 'classic' ? entry.hskClassic : entry.hskV3

  if (!unlocked) {
    return (
      <li>
        <div
          className="char-tile char-tile-locked"
          aria-label={`${entry.character} locked — clear the previous character first`}
        >
          <span className="char-lock" aria-hidden="true">
            🔒
          </span>
          <span className="char-glyph is-muted">{entry.character}</span>
          <span className="char-pinyin">{entry.pinyin}</span>
          {badge != null && (
            <span className="char-hsk-badge">HSK {badge}</span>
          )}
        </div>
      </li>
    )
  }

  return (
    <li>
      <Link
        className="char-tile"
        to={`/practice/${entry.id}`}
        aria-label={`Practice ${entry.character}, ${entry.pinyin}, ${entry.meaning}. ${cleared} of ${strokes} levels cleared.`}
      >
        <span className="char-glyph">{entry.character}</span>
        <span className="char-pinyin">{entry.pinyin}</span>
        {badge != null && <span className="char-hsk-badge">HSK {badge}</span>}
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
}
