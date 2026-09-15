import bu from './strokes/bu.json'
import de from './strokes/de.json'
import le from './strokes/le.json'
import ren from './strokes/ren.json'
import shi from './strokes/shi.json'
import ta from './strokes/ta.json'
import wo from './strokes/wo.json'
import yi from './strokes/yi.json'
import you from './strokes/you.json'
import zai from './strokes/zai.json'
import {
  contentCenterFromMedians,
  contentCenterOffset,
  offsetCharacterGeometry,
} from '../lib/grading'

/** Shape expected by hanzi-writer (from hanzi-writer-data / Make Me a Hanzi). */
export type StrokeCharacterData = {
  strokes: string[]
  medians: number[][][]
  radStrokes?: number[]
}

/** Vendored from hanzi-writer-data, keyed by character (raw MMAH coords). */
export const STROKE_DATA: Record<string, StrokeCharacterData> = {
  的: de,
  一: yi,
  是: shi,
  了: le,
  我: wo,
  不: bu,
  在: zai,
  人: ren,
  有: you,
  他: ta,
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
  const data = STROKE_DATA[char]
  if (data) {
    onLoad(centerCharacterData(data))
  } else {
    onError(new Error(`No stroke-order data for “${char}”`))
  }
}
