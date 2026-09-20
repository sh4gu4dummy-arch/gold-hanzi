import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import {
  ensureCatalogForView,
  ensureCharacterEntry,
  getCatalog,
  isV3CatalogReady,
} from '../data/characters'
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
import {
  getLastPracticePath,
  shouldSkipResume,
} from '../lib/practiceResume'
import { beatenCount, clearAllProgress } from '../lib/progress'
import { APP_VERSION } from '../version'
import type { HomeBand, HomeLesson } from '../lib/homeCatalog'

const STRICT_INFO =
  'Strict locks each next character until you clear the previous one.'
const DEV_INFO = 'Dev unlocked opens the whole catalog.'

export default function Home() {
  const navigate = useNavigate()
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

  // Cold start / post deep-link-fail: restore last practice when safe.
  useEffect(() => {
    if (shouldSkipResume()) return
    const path = getLastPracticePath()
    if (!path) return
    const id = path.slice('/practice/'.length)
    if (!id) return
    let cancelled = false
    void ensureCharacterEntry(id)
      .then((found) => {
        if (cancelled || !found) return
        navigate(path, { replace: true })
      })
      .catch(() => {
        /* stay on Home */
      })
    return () => {
      cancelled = true
    }
  }, [navigate])
  /** Classic path is ready immediately; v3 waits for lazy extras. */
  const [catalogReady, setCatalogReady] = useState(
    () => getHskView() === 'classic' || isV3CatalogReady(),
  )
  const [catalogTick, setCatalogTick] = useState(0)

  // Lazy HSK 3.0 catalog — never pulled while classic is active.
  useEffect(() => {
    let cancelled = false
    if (hskView === 'classic') {
      setCatalogReady(true)
      return
    }
    setCatalogReady(isV3CatalogReady())
    void ensureCatalogForView('v3')
      .then(() => {
        if (cancelled) return
        setCatalogReady(true)
        setCatalogTick((n) => n + 1)
      })
      .catch(() => {
        if (cancelled) return
        // Stay on classic-ready shell rather than infinite “loading”.
        setCatalogReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [hskView])

  const all = getCatalog()

  const bands = useMemo(
    () => (catalogReady ? buildBands(all, hskView) : []),
    // catalogTick bumps when v3 extras merge; revision on wipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hskView, revision, catalogReady, catalogTick],
  )
  const ordered = useMemo(
    () => (catalogReady ? entriesForView(all, hskView) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hskView, revision, catalogReady, catalogTick],
  )
  /** Classic HSK 1–6 band batteries — always classic, independent of syllabus toggle. */
  const classicBands = useMemo(
    () => buildBands(getCatalog(), 'classic'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision, catalogTick],
  )

  /** Cached battery / band progress — depends on revision (wipe / return). */
  const classicBatteryProg = useMemo(() => {
    return classicBands.map((band) => ({
      level: band.level,
      label: band.label,
      ...bandProgress(band.entries),
    }))
  }, [classicBands, revision])

  const resolvedBand =
    openBand === -1 ? null : (openBand ?? bands[0]?.level ?? null)

  // When the HSK view / band set changes, open the first lesson of the default band once.
  useEffect(() => {
    if (!catalogReady) return
    const nextBands = buildBands(getCatalog(), hskView)
    const first = nextBands[0]?.lessons[0]?.id
    if (!first) {
      setOpenLessons(new Set())
      return
    }
    setOpenLessons(new Set([first]))
    setOpenBand(null)
  }, [hskView, revision, catalogReady, catalogTick])

  // Classic HSK 1 Lesson 1 is eager — always warm on home mount / start.
  // One classic lesson chunk; does not pull HSK 3.0 modules.
  useEffect(() => {
    void ensureHsk1Lesson1Loaded().catch(() => {})
  }, [])

  // Super-lazy strokes: only load geometry for open lessons in the *active*
  // HSK view. Classic path uses classic lesson chunks only; v3 chunks load
  // only when hskView==='v3'. Battery pills use eager STROKE_COUNTS only.
  useEffect(() => {
    if (!catalogReady || openLessons.size === 0) return
    const preferV3 = hskView === 'v3'
    for (const band of bands) {
      for (const lesson of band.lessons) {
        if (!openLessons.has(lesson.id)) continue
        void ensureLessonLoaded(lesson.entries, { preferV3 }).catch(() => {})
        prefetchNextLesson(band.lessons, lesson.id, { preferV3 })
      }
    }
  }, [openLessons, bands, hskView, catalogReady])

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
          {classicBatteryProg.map((prog) => {
            const pct =
              prog.total > 0
                ? Math.round((prog.cleared / prog.total) * 100)
                : 0
            return (
              <div
                key={prog.level}
                className="home-band-battery"
                role="listitem"
                title={`${prog.label}: ${prog.cleared}/${prog.total} characters cleared (${pct}%)`}
                aria-label={`${prog.label}: ${prog.cleared} of ${prog.total} characters cleared, ${pct} percent`}
              >
                <span className="home-band-battery-label" aria-hidden="true">
                  {prog.level}
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

      <div className="home-bands" key={`${hskView}-${revision}-${catalogTick}`}>
        {!catalogReady && (
          <p className="home-empty">Loading HSK 3.0 catalog…</p>
        )}
        {catalogReady && bands.length === 0 && (
          <p className="home-empty">No characters in this HSK view yet.</p>
        )}
        {bands.map((band) => {
          const expanded = resolvedBand === band.level
          return (
            <BandSection
              key={band.level}
              band={band}
              expanded={expanded}
              openLessons={openLessons}
              ordered={ordered}
              difficulty={difficulty}
              hskView={hskView}
              revision={revision}
              onToggleBand={toggleBand}
              onToggleLesson={toggleLesson}
            />
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

/**
 * Band header always mounts; lesson list mounts only when expanded; char
 * tiles mount only when a lesson is open — keeps expand cheap.
 */
function BandSection({
  band,
  expanded,
  openLessons,
  ordered,
  difficulty,
  hskView,
  revision,
  onToggleBand,
  onToggleLesson,
}: {
  band: HomeBand
  expanded: boolean
  openLessons: Set<string>
  ordered: CharacterEntry[]
  difficulty: DifficultyMode
  hskView: HskView
  revision: number
  onToggleBand: (level: number) => void
  onToggleLesson: (lessonId: string) => void
}) {
  const prog = useMemo(
    () => bandProgress(band.entries),
    [band.entries, revision],
  )
  const lessonProg = useMemo(
    () => lessonBandProgress(band.lessons),
    [band.lessons, revision],
  )

  return (
    <section className={`hsk-band${expanded ? ' is-open' : ''}`}>
      <button
        type="button"
        className="hsk-band-head"
        aria-expanded={expanded}
        onClick={() => onToggleBand(band.level)}
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
        <BandLessonList
          lessons={band.lessons}
          openLessons={openLessons}
          ordered={ordered}
          difficulty={difficulty}
          hskView={hskView}
          revision={revision}
          onToggleLesson={onToggleLesson}
        />
      )}
    </section>
  )
}

function BandLessonList({
  lessons,
  openLessons,
  ordered,
  difficulty,
  hskView,
  revision,
  onToggleLesson,
}: {
  lessons: HomeLesson[]
  openLessons: Set<string>
  ordered: CharacterEntry[]
  difficulty: DifficultyMode
  hskView: HskView
  revision: number
  onToggleLesson: (lessonId: string) => void
}) {
  return (
    <div className="hsk-band-body">
      {lessons.map((lesson) => (
        <LessonSection
          key={lesson.id}
          lesson={lesson}
          open={openLessons.has(lesson.id)}
          ordered={ordered}
          difficulty={difficulty}
          hskView={hskView}
          revision={revision}
          onToggle={() => onToggleLesson(lesson.id)}
        />
      ))}
    </div>
  )
}

function LessonSection({
  lesson,
  open,
  ordered,
  difficulty,
  hskView,
  revision,
  onToggle,
}: {
  lesson: HomeLesson
  open: boolean
  ordered: CharacterEntry[]
  difficulty: DifficultyMode
  hskView: HskView
  revision: number
  onToggle: () => void
}) {
  const lessonProgInner = useMemo(
    () => bandProgress(lesson.entries),
    [lesson.entries, revision],
  )

  return (
    <div className={`hsk-lesson${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="hsk-lesson-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{lesson.label}</span>
        <span className="hsk-lesson-meta">
          {lessonProgInner.cleared}/{lesson.entries.length} ·{' '}
          {lesson.entries.length} chars
        </span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ol className="char-grid char-grid-compact">
          {lesson.entries.map((entry) => (
            <CharTile
              key={entry.id}
              entry={entry}
              hskView={hskView}
              unlocked={isCharacterUnlocked(entry, ordered, difficulty)}
            />
          ))}
        </ol>
      )}
    </div>
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
