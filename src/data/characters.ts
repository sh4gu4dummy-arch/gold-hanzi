import catalog from './characters.json'

export type CharacterEntry = {
  id: string
  character: string
  pinyin: string
  meaning: string
  /** Classic HSK 1–6 band (omit if not in that syllabus). */
  hskClassic?: number
  /** HSK 3.0 / 3.1 band 1–9 (omit if unknown / not listed). */
  hskV3?: number
  /** Optional context phrase (2–4 Simplified chars). */
  phrase?: string
  /** Short English gloss for `phrase`. */
  phraseGloss?: string
}

/**
 * Character catalog. HSK toggles on Home only regroup this list —
 * progress is always per character (shared across classic / 3.0 views).
 * Classic HSK 1–6 + HSK 3.0 recognition through band 9 (~3000 unique).
 */
export const CHARACTERS: CharacterEntry[] = catalog as CharacterEntry[]

export function getCharacter(id: string): CharacterEntry | undefined {
  return CHARACTERS.find((entry) => entry.id === id)
}
