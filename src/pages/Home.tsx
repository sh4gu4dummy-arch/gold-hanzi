import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import { CHARACTERS } from '../data/characters'
import type { CharacterEntry } from '../data/characters'
import {
  ensureHsk1Lesson1Loaded,
  ensureLessonLoaded,
  prefetchNextLesson,
} from '../data/strokeData'
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

const STRICT_INFO =
  'Strict locks each next character until you clear the previous one.'
const DEV_INFO = 'Dev unlocked opens the whole catalog.'

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
  const [modeInfo, setModeInfo] = useState<null | 'strict' | 'dev'>(null)
  const modeInfoRef = useRef<HTMLDivElement | null>(null)

  const bands = useMemo(
    () => buildBands(CHARACTERS, hskView),
    [hskView, revision],
  )
  const ordered = useMemo(
    () => entriesForView(CHARACTERS, hskView),
    [hskView, revision],
  )
  /** Classic HSK 1–6 band batteries — always classic, independent of syllabus toggle. */
  const classicBands = useMemo(
    () => buildBands(CHARACTERS, 'classic'),
    [revision],
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

  // HSK 1 Lesson 1 is eager — always warm on home mount / start.
  useEffect(() => {
    void ensureHsk1Lesson1Loaded()
  }, [])

  // Lesson lazy-load: when a lesson opens, load its chars; prefetch the next
  // lesson in the same band. Band modules still exist for bulk/cold paths.
  useEffect(() => {
    if (openLessons.size === 0) return
    for (const band of bands) {
      for (const lesson of band.lessons) {
        if (!openLessons.has(lesson.id)) continue
        void ensureLessonLoaded(lesson.entries)
        prefetchNextLesson(band.lessons, lesson.id)
      }
    }
  }, [openLessons, bands])

  // Dismiss Strict/Dev info popover on outside tap / Escape.
  useEffect(() => {
    if (!modeInfo) return
    const onPointer = (e: PointerEvent) => {
      const el = modeInfoRef.current
      if (el && !el.contains(e.target as Node)) setModeInfo(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModeInfo(null)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [modeInfo])

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

  const showModeInfo = (mode: 'strict' | 'dev', e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setModeInfo((cur) => (cur === mode ? null : mode))
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
          <div className="home-difficulty-wrap" ref={modeInfoRef}>
            <div
              className="home-seg home-seg-difficulty"
              role="group"
              aria-label="Difficulty"
            >
              <div
                className={`home-seg-cell${difficulty === 'strict' ? ' is-on' : ''}`}
              >
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
                  className="home-mode-info"
                  title={STRICT_INFO}
                  aria-label="About Strict mode"
                  aria-expanded={modeInfo === 'strict'}
                  onClick={(e) => showModeInfo('strict', e)}
                >
                  ⓘ
                </button>
              </div>
              <div
                className={`home-seg-cell${difficulty === 'dev' ? ' is-on' : ''}`}
              >
                <button
                  type="button"
                  className={`home-seg-btn${difficulty === 'dev' ? ' is-on' : ''}`}
                  aria-pressed={difficulty === 'dev'}
                  onClick={() => onDifficulty('dev')}
                >
                  Dev unlocked
                </button>
                <button
                  type="button"
                  className="home-mode-info"
                  title={DEV_INFO}
                  aria-label="About Dev unlocked mode"
                  aria-expanded={modeInfo === 'dev'}
                  onClick={(e) => showModeInfo('dev', e)}
                >
                  ⓘ
                </button>
              </div>
            </div>
            {modeInfo && (
              <div className="home-mode-popover" role="status">
                <strong>
                  {modeInfo === 'strict' ? 'Strict' : 'Dev unlocked'}
                </strong>
                <p>{modeInfo === 'strict' ? STRICT_INFO : DEV_INFO}</p>
              </div>
            )}
          </div>
        </div>

        <div
          className="home-band-batteries"
          role="list"
          aria-label="Classic HSK 1–6 band progress"
        >
          {classicBands.map((band) => {
            const prog = bandProgress(band.entries)
            const pct =
              prog.total > 0
                ? Math.round((prog.cleared / prog.total) * 100)
                : 0
            return (
              <div
                key={band.level}
                className="home-band-battery"
                role="listitem"
                title={`${band.label}: ${prog.cleared}/${prog.total} characters cleared (${pct}%)`}
                aria-label={`${band.label}: ${prog.cleared} of ${prog.total} characters cleared, ${pct} percent`}
              >
                <span className="home-band-battery-label" aria-hidden="true">
                  {band.level}
                </span>
                <span className="home-band-battery-track" aria-hidden="true">
                  <span
                    className="home-band-battery-fill"
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </div>
            )
          })}
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
                    const lessonProgInner = bandProgress(lesson.entries)
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
                            {lessonProgInner.cleared}/{lesson.entries.length} ·{' '}
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

      <div className="home-footer-wipe">
        <button
          type="button"
          className="link-danger home-wipe-link"
          onClick={handleWipeAll}
        >
          wipe all
        </button>
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
