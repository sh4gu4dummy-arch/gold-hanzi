import type { CharacterEntry } from './characters'
import {
  contentCenterFromMedians,
  contentCenterOffset,
  offsetCharacterGeometry,
} from '../lib/grading'
import { CHAR_BANDS } from './charBands'
import { CHAR_CLASSIC_LESSON, CHAR_V3_LESSON } from './charLessons'

/** Shape expected by hanzi-writer (from hanzi-writer-data / Make Me a Hanzi). */
export type StrokeCharacterData = {
  strokes: string[]
  medians: number[][][]
  radStrokes?: number[]
}

/**
 * Mutable cache of stroke geometry. Populated from lesson chunks (preferred)
 * or classic HSK band modules. HSK 3.0 lesson chunks load only when the
 * v3 view / a v3-only character needs them — never while classic is active.
 */
export const STROKE_DATA: Record<string, StrokeCharacterData> = {}

const bandPromises = new Map<number, Promise<void>>()
const lessonPromises = new Map<string, Promise<void>>()
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

/** Classic lesson chunks — safe on the classic Home path. */
const classicLessonModules = import.meta.glob<{
  default: Record<string, StrokeCharacterData>
}>('./strokeLessons/classic/*.json')

/**
 * HSK 3.0 lesson chunks — glob registers URLs only; nothing is fetched until
 * ensureV3LessonLoaded / load path explicitly imports a module.
 */
const v3LessonModules = import.meta.glob<{
  default: Record<string, StrokeCharacterData>
}>('./strokeLessons/v3/*.json')

function lessonKey(view: 'classic' | 'v3', lessonId: string): string {
  return `${view}:${lessonId}`
}

function assignLessonData(data: Record<string, StrokeCharacterData>): void {
  Object.assign(STROKE_DATA, data)
}

/** Load (once) one classic lesson chunk (~12 chars) into STROKE_DATA. */
export function ensureClassicLessonLoaded(lessonId: string): Promise<void> {
  const key = lessonKey('classic', lessonId)
  let p = lessonPromises.get(key)
  if (!p) {
    const modPath = `./strokeLessons/classic/${lessonId}.json`
    const loader = classicLessonModules[modPath]
    if (!loader) {
      p = Promise.resolve()
    } else {
      p = loader()
        .then((mod) => {
          assignLessonData(mod.default)
        })
        .catch((err) => {
          lessonPromises.delete(key)
          throw err
        })
    }
    lessonPromises.set(key, p)
  }
  return p
}

/**
 * Load one HSK 3.0 lesson chunk. Call only from the v3 view / v3-only
 * character paths — never while hskView==='classic'.
 */
export function ensureV3LessonLoaded(lessonId: string): Promise<void> {
  const key = lessonKey('v3', lessonId)
  let p = lessonPromises.get(key)
  if (!p) {
    const modPath = `./strokeLessons/v3/${lessonId}.json`
    const loader = v3LessonModules[modPath]
    if (!loader) {
      p = Promise.resolve()
    } else {
      p = loader()
        .then((mod) => {
          assignLessonData(mod.default)
        })
        .catch((err) => {
          lessonPromises.delete(key)
          throw err
        })
    }
    lessonPromises.set(key, p)
  }
  return p
}

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

/**
 * Prefer classic lesson chunk, then classic band module, then (only if needed)
 * a v3 lesson chunk for v3-only glyphs.
 */
function loadOneCharacter(character: string): Promise<void> {
  if (STROKE_DATA[character]) return Promise.resolve()
  let p = charPromises.get(character)
  if (!p) {
    const classicLesson = CHAR_CLASSIC_LESSON[character]
    if (classicLesson) {
      p = ensureClassicLessonLoaded(classicLesson)
    } else {
      const band = CHAR_BANDS[character]
      if (band != null) {
        p = ensureBandLoaded(band)
      } else {
        const v3Lesson = CHAR_V3_LESSON[character]
        if (v3Lesson) {
          p = ensureV3LessonLoaded(v3Lesson)
        } else {
          p = Promise.resolve()
        }
      }
    }
    charPromises.set(
      character,
      p.catch((err) => {
        charPromises.delete(character)
        throw err
      }),
    )
  }
  return charPromises.get(character)!
}

/** Load stroke geometry for specific characters (lesson-sized / prefetch). */
export function ensureCharactersLoaded(
  characters: readonly string[],
): Promise<void> {
  return Promise.all(characters.filter(Boolean).map(loadOneCharacter)).then(
    () => {},
  )
}

/**
 * Load every character in a home lesson as **one** (or few) chunk request(s).
 * Uses classic lesson modules when `preferV3` is false; v3 modules otherwise.
 */
export function ensureLessonLoaded(
  entries: readonly CharacterEntry[],
  opts?: { preferV3?: boolean },
): Promise<void> {
  if (entries.length === 0) return Promise.resolve()
  const preferV3 = opts?.preferV3 === true
  // All entries in a home lesson share one lesson id in that view.
  const sample = entries[0]!.character
  if (preferV3) {
    const id = CHAR_V3_LESSON[sample]
    if (id) return ensureV3LessonLoaded(id)
  } else {
    const id = CHAR_CLASSIC_LESSON[sample]
    if (id) return ensureClassicLessonLoaded(id)
  }
  // Fallback: per-character resolution (still batches via shared promises).
  return ensureCharactersLoaded(entries.map((e) => e.character))
}

/**
 * Classic HSK 1 Lesson 1 — first 12 classic-band-1 catalog chars.
 * Eager on app start / home load (not lazy). One lesson chunk.
 */
export function ensureHsk1Lesson1Loaded(): Promise<void> {
  return ensureClassicLessonLoaded('hsk1-l1')
}

/** Prefetch the next lesson in the same band after `lessonId`. */
export function prefetchNextLesson(
  bandLessons: readonly { id: string; entries: CharacterEntry[] }[],
  lessonId: string,
  opts?: { preferV3?: boolean },
): void {
  const idx = bandLessons.findIndex((l) => l.id === lessonId)
  if (idx < 0) return
  const next = bandLessons[idx + 1]
  if (!next) return
  void ensureLessonLoaded(next.entries, opts)
}

/** Classic HSK band for a character, if known. */
export function bandForCharacter(character: string): number | undefined {
  return CHAR_BANDS[character]
}

/** Ensure stroke data for this character is loaded (lesson / band chunk). */
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

/** Debug / audit: classic lesson module paths registered (not fetched). */
export function classicLessonModuleCount(): number {
  return Object.keys(classicLessonModules).length
}

/** Debug / audit: v3 lesson module paths registered (not fetched). */
export function v3LessonModuleCount(): number {
  return Object.keys(v3LessonModules).length
}

