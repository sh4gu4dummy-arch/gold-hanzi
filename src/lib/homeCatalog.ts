import type { CharacterEntry } from '../data/characters'
import { STROKE_DATA } from '../data/strokeData'
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

/** Raw Make-Me-a-Hanzi stroke count (guides / grading). */
export function rawStrokeCount(character: string): number {
  return STROKE_DATA[character]?.strokes.length ?? 0
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
