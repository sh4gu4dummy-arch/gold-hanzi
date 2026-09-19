import type { CharacterEntry } from './characters'
import { CHARACTERS } from './characters'
import {
  contentCenterFromMedians,
  contentCenterOffset,
  offsetCharacterGeometry,
} from '../lib/grading'
import { CHAR_BANDS } from './charBands'

/** Shape expected by hanzi-writer (from hanzi-writer-data / Make Me a Hanzi). */
export type StrokeCharacterData = {
  strokes: string[]
  medians: number[][][]
  radStrokes?: number[]
}

/**
 * Mutable cache of stroke geometry. Populated when an HSK band module loads
 * or when individual lesson/character JSON chunks arrive.
 * Prefer ensureBandLoaded / ensureCharactersLoaded / ensureCharacterStrokes
 * over reading this cold.
 */
export const STROKE_DATA: Record<string, StrokeCharacterData> = {}

const bandPromises = new Map<number, Promise<void>>()
const charPromises = new Map<string, Promise<void>>()

const BAND_LOADERS: Record<
  number,
  () => Promise<{ default: Record<string, StrokeCharacterData> }>
> = {
  1: () => import('./strokeBands/hsk1'),
  2: () => import('./strokeBands/hsk2'),
  3: () => import('./strokeBands/hsk3'),
  4: () => import('./strokeBands/hsk4'),
  5: () => import('./strokeBands/hsk5'),
  6: () => import('./strokeBands/hsk6'),
}

/** Per-file stroke JSON — Vite code-splits so lessons can load only their chars. */
const strokeModules = import.meta.glob<{ default: StrokeCharacterData }>(
  './strokes/*.json',
)

const CHAR_TO_ID: Record<string, string> = Object.fromEntries(
  CHARACTERS.map((e) => [e.character, e.id]),
)

/** Classic HSK 1 lesson size (must match homeCatalog.LESSON_SIZE). */
const HSK1_LESSON1_SIZE = 12

/** Load (once) all stroke JSON for a classic HSK band into STROKE_DATA. */
export function ensureBandLoaded(band: number): Promise<void> {
  if (!BAND_LOADERS[band]) return Promise.resolve()
  let p = bandPromises.get(band)
  if (!p) {
    p = BAND_LOADERS[band]!()
      .then((mod) => {
        Object.assign(STROKE_DATA, mod.default)
      })
      .catch((err) => {
        bandPromises.delete(band)
        throw err
      })
    bandPromises.set(band, p)
  }
  return p
}

function loadOneCharacter(character: string): Promise<void> {
  if (STROKE_DATA[character]) return Promise.resolve()
  let p = charPromises.get(character)
  if (!p) {
    const id = CHAR_TO_ID[character]
    const key = id ? `./strokes/${id}.json` : undefined
    const loader = key ? strokeModules[key] : undefined
    if (loader) {
      p = loader()
        .then((mod) => {
          STROKE_DATA[character] = mod.default
        })
        .catch((err) => {
          charPromises.delete(character)
          throw err
        })
    } else {
      const band = CHAR_BANDS[character]
      p = band != null ? ensureBandLoaded(band) : Promise.resolve()
    }
    charPromises.set(character, p)
  }
  return p
}

/** Load stroke geometry for specific characters (lesson-sized / prefetch). */
export function ensureCharactersLoaded(
  characters: readonly string[],
): Promise<void> {
  return Promise.all(characters.filter(Boolean).map(loadOneCharacter)).then(
    () => {},
  )
}

/** Load every character in a home lesson. */
export function ensureLessonLoaded(
  entries: readonly CharacterEntry[],
): Promise<void> {
  return ensureCharactersLoaded(entries.map((e) => e.character))
}

/**
 * Classic HSK 1 Lesson 1 — first 12 classic-band-1 catalog chars.
 * Eager on app start / home load (not lazy).
 */
export function ensureHsk1Lesson1Loaded(): Promise<void> {
  const chars = CHARACTERS.filter((e) => e.hskClassic === 1)
    .slice(0, HSK1_LESSON1_SIZE)
    .map((e) => e.character)
  return ensureCharactersLoaded(chars)
}

/** Prefetch the next lesson in the same band after `lessonId`. */
export function prefetchNextLesson(
  bandLessons: readonly { id: string; entries: CharacterEntry[] }[],
  lessonId: string,
): void {
  const idx = bandLessons.findIndex((l) => l.id === lessonId)
  if (idx < 0) return
  const next = bandLessons[idx + 1]
  if (!next) return
  void ensureLessonLoaded(next.entries)
}

/** Classic HSK band for a character, if known. */
export function bandForCharacter(character: string): number | undefined {
  return CHAR_BANDS[character]
}

/** Ensure stroke data for this character is loaded (per-char chunk). */
export function ensureCharacterStrokes(character: string): Promise<void> {
  return loadOneCharacter(character)
}

/** Sync read after ensure*; undefined until that band/char has loaded. */
export function getStrokeData(
  character: string,
): StrokeCharacterData | undefined {
  return STROKE_DATA[character]
}

/**
 * Center glyph content on the 1024 viewBox midpoints (same offset as
 * applyHanziTransform / mapMediansToCanvas) so hanzi-writer demos match
 * the TracePad underlay on the mi-zi-ge midline.
 */
export function centerCharacterData(
  data: StrokeCharacterData,
): StrokeCharacterData {
  const center = contentCenterFromMedians(data.medians)
  const offset = contentCenterOffset(center)
  const { strokes, medians } = offsetCharacterGeometry(
    data.strokes,
    data.medians,
    offset,
  )
  return {
    strokes,
    medians,
    ...(data.radStrokes ? { radStrokes: data.radStrokes } : {}),
  }
}

export function charDataLoader(
  char: string,
  onLoad: (data: StrokeCharacterData) => void,
  onError: (err?: Error) => void,
): void {
  void ensureCharacterStrokes(char)
    .then(() => {
      const data = STROKE_DATA[char]
      if (data) {
        onLoad(centerCharacterData(data))
      } else {
        onError(new Error(`No stroke-order data for “${char}”`))
      }
    })
    .catch((err: unknown) => {
      onError(err instanceof Error ? err : new Error(String(err)))
    })
}
