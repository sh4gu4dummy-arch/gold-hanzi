import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import TracePad, { DEFAULT_ACCENT } from '../components/TracePad'
import { CHARACTERS, getCharacter } from '../data/characters'
import {
  entriesForView,
  nextUnlockedEntry,
  strokeLevelCount,
} from '../lib/homeCatalog'
import { getDifficultyMode, getHskView } from '../lib/homePref'
import { clearCharProgress, getCharProgress } from '../lib/progress'
import type { CharProgress } from '../lib/progress'
import { speakHanzi } from '../lib/speak'
import { getSoundEnabled } from '../lib/soundPref'
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

  const handleGlyphSpeak = () => {
    if (!getSoundEnabled()) return
    void speakHanzi(entry.character)
  }

  return (
    <main className="page practice">
      <header className="practice-bar">
        <div className="practice-bar-row">
          <Link className="back-link" to="/" title="Home" aria-label="Home">
            ←
          </Link>
          <div className="practice-meta">
            <h1>
              <button
                type="button"
                className="practice-glyph-btn"
                onClick={handleGlyphSpeak}
                title="Speak character"
                aria-label={`Speak ${entry.character}`}
              >
                <span className="practice-glyph">{entry.character}</span>
              </button>
              <span className="practice-pinyin">{entry.pinyin}</span>
            </h1>
            <p className="practice-meta-sub">
              {entry.meaning}
              {levelCount > 0 && (
                <>
                  {' '}
                  · {cleared}/{levelCount}
                </>
              )}
            </p>
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
      </header>

      <TracePad
        key={`${entry.id}-${padRevision}`}
        character={entry.character}
        accent={DEFAULT_ACCENT}
        nextCharacter={
          allLevelsCleared
            ? nextEntry
              ? {
                  id: nextEntry.id,
                  character: nextEntry.character,
                  pinyin: nextEntry.pinyin,
                }
              : null
            : undefined
        }
        onDone={() => setFinishedChar(entry.character)}
        onProgressChange={(nextProgress) =>
          setProgressByChar((prev) => ({
            ...prev,
            [entry.character]: nextProgress,
          }))
        }
      />

      <div className="practice-wipe-row">
        <button
          type="button"
          className="link-danger"
          onClick={handleWipeChar}
        >
          Wipe this character’s progress
        </button>
      </div>

      {finished && allLevelsCleared && (
        <div className="next-char-banner">
          {nextEntry ? (
            <Link
              className="btn btn-primary next-char-btn"
              to={`/practice/${nextEntry.id}`}
            >
              Next character · {nextEntry.character} {nextEntry.pinyin}
            </Link>
          ) : (
            <p className="next-hint next-caught-up">
              All caught up!{' '}
              <Link to="/">Back to home</Link>
            </p>
          )}
        </div>
      )}
    </main>
  )
}
