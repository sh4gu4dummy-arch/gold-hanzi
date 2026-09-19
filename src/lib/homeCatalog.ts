import type { CharacterEntry } from '../data/characters'
import { STROKE_COUNTS } from '../data/strokeCounts'
import { beatenCount } from './progress'
import type { DifficultyMode, HskView } from './homePref'

export const LESSON_SIZE = 12

export type HomeLesson = {
  id: string
  label: string
  entries: CharacterEntry[]
}

export type HomeBand = {
  level: number
  label: string
  lessons: HomeLesson[]
  entries: CharacterEntry[]
}

function bandFor(entry: CharacterEntry, view: HskView): number | null {
  if (view === 'classic') return entry.hskClassic ?? null
  return entry.hskV3 ?? null
}

/** Characters for the active HSK view, ordered by band then list order. */
export function entriesForView(
  all: CharacterEntry[],
  view: HskView,
): CharacterEntry[] {
  return all
    .map((e, index) => ({ e, index, band: bandFor(e, view) }))
    .filter((x) => x.band != null && x.band >= 1)
    .sort((a, b) => a.band! - b.band! || a.index - b.index)
    .map((x) => x.e)
}

export function buildBands(
  all: CharacterEntry[],
  view: HskView,
): HomeBand[] {
  const filtered = entriesForView(all, view)
  const byLevel = new Map<number, CharacterEntry[]>()
  for (const e of filtered) {
    const level = bandFor(e, view)!
    const list = byLevel.get(level) ?? []
    list.push(e)
    byLevel.set(level, list)
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b)
  return levels.map((level) => {
    const entries = byLevel.get(level)!
    const lessons: HomeLesson[] = []
    for (let i = 0; i < entries.length; i += LESSON_SIZE) {
      const slice = entries.slice(i, i + LESSON_SIZE)
      const n = Math.floor(i / LESSON_SIZE) + 1
      lessons.push({
        id: `hsk${level}-l${n}`,
        label: `Lesson ${n}`,
        entries: slice,
      })
    }
    return {
      level,
      label: view === 'classic' ? `HSK ${level}` : `HSK 3.0 · ${level}`,
      lessons,
      entries,
    }
  })
}

/** Raw Make-Me-a-Hanzi stroke count (guides / grading). Eager counts map. */
export function rawStrokeCount(character: string): number {
  return STROKE_COUNTS[character] ?? 0
}

/**
 * Practice levels per character: one progressive-memory level per stroke,
 * plus one final all-strokes memory level (no guide).
 * levelCount = strokeCount + 1 when strokeCount > 0.
 */
export function strokeLevelCount(character: string): number {
  const n = rawStrokeCount(character)
  return n > 0 ? n + 1 : 0
}

/** True when every practice level for this character is beaten (incl. final memory). */
export function isCharacterCleared(character: string): boolean {
  const n = strokeLevelCount(character)
  if (n <= 0) return false
  return beatenCount(character) >= n
}

/**
 * Strict: unlock next character only after previous in the flat view order
 * is fully cleared. Dev: all unlocked. First character always unlocked.
 */
export function isCharacterUnlocked(
  entry: CharacterEntry,
  ordered: CharacterEntry[],
  mode: DifficultyMode,
): boolean {
  if (mode === 'dev') return true
  const idx = ordered.findIndex((e) => e.id === entry.id)
  if (idx <= 0) return true
  const prev = ordered[idx - 1]!
  return isCharacterCleared(prev.character)
}

export function bandProgress(entries: CharacterEntry[]): {
  cleared: number
  total: number
} {
  let cleared = 0
  for (const e of entries) {
    if (isCharacterCleared(e.character)) cleared += 1
  }
  return { cleared, total: entries.length }
}

/** Locate the HSK band + lesson that contain this entry in the active view. */
export function locateEntryBandLesson(
  entry: CharacterEntry,
  all: CharacterEntry[],
  view: HskView,
): {
  band: HomeBand
  lesson: HomeLesson
  lessonNumber: number
} | null {
  const bands = buildBands(all, view)
  for (const band of bands) {
    for (let i = 0; i < band.lessons.length; i++) {
      const lesson = band.lessons[i]!
      if (lesson.entries.some((e) => e.id === entry.id)) {
        return { band, lesson, lessonNumber: i + 1 }
      }
    }
  }
  return null
}

/**
 * A lesson is cleared when every character in it is fully cleared (all levels).
 */
export function lessonBandProgress(lessons: HomeLesson[]): {
  cleared: number
  total: number
} {
  let cleared = 0
  for (const lesson of lessons) {
    if (
      lesson.entries.length > 0 &&
      lesson.entries.every((e) => isCharacterCleared(e.character))
    ) {
      cleared += 1
    }
  }
  return { cleared, total: lessons.length }
}

/**
 * Next unlocked character after `currentId` in the flat HSK view order
 * (same order as home / Strict unlock). Skips locked entries. Null if none.
 */
export function nextUnlockedEntry(
  currentId: string,
  ordered: CharacterEntry[],
  mode: DifficultyMode,
): CharacterEntry | null {
  const idx = ordered.findIndex((e) => e.id === currentId)
  if (idx < 0) return null
  for (let i = idx + 1; i < ordered.length; i++) {
    const candidate = ordered[i]!
    if (isCharacterUnlocked(candidate, ordered, mode)) {
      return candidate
    }
  }
  return null
}
