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
 * Mutable cache of stroke geometry. Populated when an HSK band module loads.
 * Prefer ensureBandLoaded / ensureCharacterStrokes over reading this cold.
 */
export const STROKE_DATA: Record<string, StrokeCharacterData> = {}

const bandPromises = new Map<number, Promise<void>>()

const BAND_LOADERS: Record<number, () => Promise<{ default: Record<string, StrokeCharacterData> }>> = {
  1: () => import('./strokeBands/hsk1'),
  2: () => import('./strokeBands/hsk2'),
  3: () => import('./strokeBands/hsk3'),
  4: () => import('./strokeBands/hsk4'),
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

/** Classic HSK band for a character, if known. */
export function bandForCharacter(character: string): number | undefined {
  return CHAR_BANDS[character]
}

/** Ensure the band that owns this character is loaded. */
export function ensureCharacterStrokes(character: string): Promise<void> {
  const band = CHAR_BANDS[character]
  if (band == null) return Promise.resolve()
  return ensureBandLoaded(band)
}

/** Sync read after ensure*; undefined until that band has loaded. */
export function getStrokeData(character: string): StrokeCharacterData | undefined {
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
