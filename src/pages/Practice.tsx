import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import TracePad, { DEFAULT_ACCENT } from '../components/TracePad'
import { CHARACTERS, getCharacter } from '../data/characters'
import {
  bandProgress,
  entriesForView,
  locateEntryBandLesson,
  nextUnlockedEntry,
  strokeLevelCount,
} from '../lib/homeCatalog'
import { getDifficultyMode, getHskView } from '../lib/homePref'
import { clearCharProgress, getCharProgress } from '../lib/progress'
import type { CharProgress } from '../lib/progress'
import { speakHanzi } from '../lib/speak'
import { APP_VERSION } from '../version'

export default function Practice() {
  const { id = '' } = useParams()
  const entry = getCharacter(id)

  const levelCount = entry ? strokeLevelCount(entry.character) : 0

  const [progressByChar, setProgressByChar] = useState<
    Record<string, CharProgress>
  >({})
  const [finishedChar, setFinishedChar] = useState<string | null>(null)
  const [padRevision, setPadRevision] = useState(0)
  /** Host for TracePad level-pip strip (ported under big pinyin). */
  const [levelPipsHost, setLevelPipsHost] = useState<HTMLElement | null>(null)

  const progress: CharProgress = entry
    ? (progressByChar[entry.character] ?? getCharProgress(entry.character))
    : { beaten: [] }

  const ordered = useMemo(
    () => entriesForView(CHARACTERS, getHskView()),
    // Recompute when navigating characters; prefs read from localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.id],
  )

  const nextEntry = useMemo(() => {
    if (!entry) return null
    return nextUnlockedEntry(entry.id, ordered, getDifficultyMode())
  }, [entry, ordered, progress.beaten.length, finishedChar])

  /** Current character's HSK band/lesson completion (Home accordion metrics). */
  const bandLessonMeta = useMemo(() => {
    if (!entry) return null
    const view = getHskView()
    const loc = locateEntryBandLesson(entry, CHARACTERS, view)
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
  }, [entry, progressByChar])

  const allLevelsCleared =
    !!entry &&
    levelCount > 0 &&
    progress.beaten.length >= levelCount &&
    (finishedChar === entry.character ||
      progress.beaten.length >= levelCount)

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
        onDone={() => setFinishedChar(entry.character)}
        onProgressChange={(nextProgress) =>
          setProgressByChar((prev) => ({
            ...prev,
            [entry.character]: nextProgress,
          }))
        }
      />

      <div className="practice-footer-row">
        {finished && allLevelsCleared &&
          (nextEntry ? (
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
          ))}
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
