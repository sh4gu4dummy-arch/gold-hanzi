import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import TracePad, { DEFAULT_ACCENT } from '../components/TracePad'
import {
  ensureCatalogForView,
  ensureCharacterEntry,
  getCatalog,
  getCharacter,
} from '../data/characters'
import type { CharacterEntry } from '../data/characters'
import {
  bandProgress,
  entriesForView,
  locateEntryBandLesson,
  nextUnlockedEntry,
  strokeLevelCount,
} from '../lib/homeCatalog'
import {
  getDifficultyMode,
  getHskView,
  getPhrasePanelOpen,
  getPhrasesEnabled,
  getSoundTipSeen,
  setPhrasePanelOpen,
  setPhrasesEnabled,
  setSoundTipSeen,
} from '../lib/homePref'
import { getSoundEnabled } from '../lib/soundPref'
import { clearCharProgress, getCharProgress } from '../lib/progress'
import type { CharProgress } from '../lib/progress'
import { speakHanzi } from '../lib/speak'
import { APP_VERSION } from '../version'

export default function Practice() {
  const { id = '' } = useParams()
  const [entry, setEntry] = useState<CharacterEntry | undefined>(() =>
    getCharacter(id),
  )
  const [entryResolved, setEntryResolved] = useState(() => !!getCharacter(id))
  const [catalogTick, setCatalogTick] = useState(0)

  // Resolve classic sync; lazy-load HSK 3.0 extras only if id is missing.
  useEffect(() => {
    let cancelled = false
    const hit = getCharacter(id)
    if (hit) {
      setEntry(hit)
      setEntryResolved(true)
      // If user is on v3 view, still warm the extras for next/ordered.
      if (getHskView() === 'v3') {
        void ensureCatalogForView('v3')
          .then(() => {
            if (!cancelled) setCatalogTick((n) => n + 1)
          })
          .catch(() => {})
      }
      return
    }
    setEntryResolved(false)
    void ensureCharacterEntry(id)
      .then((found) => {
        if (cancelled) return
        setEntry(found)
        setEntryResolved(true)
        setCatalogTick((n) => n + 1)
      })
      .catch(() => {
        if (cancelled) return
        setEntry(undefined)
        setEntryResolved(true)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const levelCount = entry ? strokeLevelCount(entry.character) : 0

  const [progressByChar, setProgressByChar] = useState<
    Record<string, CharProgress>
  >({})
  const [finishedChar, setFinishedChar] = useState<string | null>(null)
  const [padRevision, setPadRevision] = useState(0)
  /** Host for TracePad level-pip strip (ported under big pinyin). */
  const [levelPipsHost, setLevelPipsHost] = useState<HTMLElement | null>(null)
  const [showSoundTip, setShowSoundTip] = useState(() => !getSoundTipSeen())
  const [phraseOpen, setPhraseOpen] = useState(() => getPhrasePanelOpen())
  const [phrasesEnabled, setPhrasesEnabledState] = useState(() =>
    getPhrasesEnabled(),
  )

  const progress: CharProgress = entry
    ? (progressByChar[entry.character] ?? getCharProgress(entry.character))
    : { beaten: [] }

  const ordered = useMemo(
    () => entriesForView(getCatalog(), getHskView()),
    // Recompute when navigating characters / v3 catalog merges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.id, catalogTick],
  )

  const nextEntry = useMemo(() => {
    if (!entry) return null
    return nextUnlockedEntry(entry.id, ordered, getDifficultyMode())
  }, [entry, ordered, progress.beaten.length, finishedChar])

  /** Current character's HSK band/lesson completion (Home accordion metrics). */
  const bandLessonMeta = useMemo(() => {
    if (!entry) return null
    const view = getHskView()
    const loc = locateEntryBandLesson(entry, getCatalog(), view)
    if (!loc) return null
    const lessonChars = bandProgress(loc.lesson.entries)
    const bandChars = bandProgress(loc.band.entries)
    return {
      lessonNumber: loc.lessonNumber,
      lessonCleared: lessonChars.cleared,
      lessonTotal: lessonChars.total,
      bandLabel: loc.band.label,
      bandCleared: bandChars.cleared,
      bandTotal: bandChars.total,
    }
    // progressByChar updates after markLevelBeaten (localStorage already written).
  }, [entry, progressByChar, catalogTick])

  const allLevelsCleared =
    !!entry &&
    levelCount > 0 &&
    progress.beaten.length >= levelCount &&
    (finishedChar === entry.character ||
      progress.beaten.length >= levelCount)

  if (!entryResolved) {
    return (
      <main className="page practice">
        <p className="home-empty">Loading character…</p>
      </main>
    )
  }

  if (!entry) {
    return <Navigate to="/" replace />
  }

  const cleared = progress.beaten.length
  const finished = finishedChar === entry.character || allLevelsCleared

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

  const handleSpeak = () => {
    // Manual replay — always allowed, even when auto Sound is off.
    void speakHanzi(entry.character)
  }

  return (
    <main className="page practice">
      <header className="practice-bar">
        <div className="practice-bar-row">
          <Link className="practice-home" to="/" title="Home" aria-label="Home">
            <span className="practice-home-icon" aria-hidden="true">
              ⌂
            </span>
            <span className="practice-home-label">Home</span>
          </Link>
          <div className="practice-pinyin-row">
            <span className="practice-pinyin">{entry.pinyin}</span>
            <button
              type="button"
              className="practice-speak-btn"
              onClick={handleSpeak}
              title="Replay pronunciation"
              aria-label={`Speak ${entry.character}, ${entry.pinyin}`}
            >
              <span aria-hidden="true">🔊</span>
            </button>
          </div>
          <div className="practice-bar-actions">
            <span
              className="app-version"
              aria-label={`App version ${APP_VERSION}`}
            >
              {APP_VERSION}
            </span>
            <ThemeToggle />
          </div>
        </div>
        <div className="practice-meta">
          <p className="practice-meta-sub">
            {entry.meaning}
            {levelCount > 0 && (
              <>
                {' '}
                · {cleared}/{levelCount}
              </>
            )}
          </p>
          {bandLessonMeta && (
            <p
              className="practice-meta-band"
              title={`${bandLessonMeta.bandLabel}: ${bandLessonMeta.bandCleared}/${bandLessonMeta.bandTotal} chars · Lesson ${bandLessonMeta.lessonNumber}: ${bandLessonMeta.lessonCleared}/${bandLessonMeta.lessonTotal} cleared`}
            >
              L{bandLessonMeta.lessonNumber}{' '}
              {bandLessonMeta.lessonCleared}/{bandLessonMeta.lessonTotal}
              {' · '}
              {bandLessonMeta.bandLabel} {bandLessonMeta.bandCleared}/
              {bandLessonMeta.bandTotal}
            </p>
          )}
        </div>

        {phrasesEnabled && entry.phrase && entry.phraseGloss && (
          <div className="practice-phrase-panel">
            <div className="practice-phrase-head">
              <button
                type="button"
                className="practice-phrase-toggle"
                aria-expanded={phraseOpen}
                onClick={() => {
                  setPhraseOpen((open) => {
                    const next = !open
                    setPhrasePanelOpen(next)
                    return next
                  })
                }}
              >
                <span>Context phrase</span>
                <span className="practice-phrase-chev" aria-hidden="true">
                  {phraseOpen ? '▾' : '▸'}
                </span>
              </button>
              <button
                type="button"
                className="practice-phrase-hide"
                title="Hide phrases"
                aria-label="Hide context phrases"
                onClick={() => {
                  setPhrasesEnabled(false)
                  setPhrasesEnabledState(false)
                }}
              >
                Hide
              </button>
            </div>
            {phraseOpen && (
              <div className="practice-phrase-body">
                <button
                  type="button"
                  className="practice-phrase-hanzi"
                  lang="zh-Hans"
                  aria-label={`Speak phrase ${entry.phrase}`}
                  title="Speak phrase"
                  onClick={() => {
                    if (getSoundEnabled()) void speakHanzi(entry.phrase!)
                  }}
                >
                  {Array.from(entry.phrase).map((ch, i) => (
                    <span
                      key={`${ch}-${i}`}
                      className={`practice-phrase-char${
                        ch === entry.character ? ' is-current' : ''
                      }`}
                    >
                      {ch}
                    </span>
                  ))}
                </button>
                <p className="practice-phrase-gloss">{entry.phraseGloss}</p>
              </div>
            )}
          </div>
        )}
        {!phrasesEnabled && entry.phrase && entry.phraseGloss && (
          <button
            type="button"
            className="practice-phrase-show"
            onClick={() => {
              setPhrasesEnabled(true)
              setPhrasesEnabledState(true)
            }}
          >
            Show context phrases
          </button>
        )}

        {showSoundTip && (
          <div className="practice-sound-tip" role="status">
            <span>
              🔊 = hear now, 🎧 = auto.
            </span>
            <button
              type="button"
              className="practice-sound-tip-dismiss"
              aria-label="Dismiss tip"
              onClick={() => {
                setSoundTipSeen()
                setShowSoundTip(false)
              }}
            >
              ×
            </button>
          </div>
        )}
        <div
          className="practice-level-pips-slot"
          ref={setLevelPipsHost}
        />
      </header>

      <TracePad
        key={`${entry.id}-${padRevision}`}
        character={entry.character}
        accent={DEFAULT_ACCENT}
        levelPipsHost={levelPipsHost}
        nextCharAction={
          finished && allLevelsCleared ? (
            nextEntry ? (
              <Link
                className="btn btn-primary next-char-btn next-char-btn-sm"
                to={`/practice/${nextEntry.id}`}
              >
                Next character · {nextEntry.character} {nextEntry.pinyin}
              </Link>
            ) : (
              <p className="next-hint next-caught-up">
                All caught up!{' '}
                <Link to="/">Back to home</Link>
              </p>
            )
          ) : null
        }
        onDone={() => setFinishedChar(entry.character)}
        onProgressChange={(nextProgress) =>
          setProgressByChar((prev) => ({
            ...prev,
            [entry.character]: nextProgress,
          }))
        }
      />

      <div className="practice-footer-row">
        <button
          type="button"
          className="link-danger"
          onClick={handleWipeChar}
        >
          Wipe this character's progress
        </button>
      </div>
    </main>
  )
}
