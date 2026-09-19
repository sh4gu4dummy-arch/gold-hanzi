import classicCatalog from './characters-classic.json'
import type { HskView } from '../lib/homePref'

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
 * Classic HSK 1–6 catalog — eager, small enough for a snappy Home.
 * HSK 3.0-only extras (+phrases) load only via ensureV3Catalog() after
 * the user toggles HSK 3.0 (never on the classic path).
 */
const classic: CharacterEntry[] = (classicCatalog as CharacterEntry[]).slice()

let catalog: CharacterEntry[] = classic
let byId = new Map(classic.map((e) => [e.id, e]))
let v3Merged = false
let v3Promise: Promise<void> | null = null

function rebuildIndex(list: CharacterEntry[]): void {
  catalog = list
  byId = new Map(list.map((e) => [e.id, e]))
  // Keep legacy CHARACTERS export in sync (same array reference when possible).
  CHARACTERS = list
}

/** Active catalog (classic only until ensureV3Catalog resolves). */
export function getCatalog(): CharacterEntry[] {
  return catalog
}

/**
 * Live catalog array. Prefer getCatalog(). Mutated in place only via
 * rebuildIndex after v3 merge (new array reference).
 */
export let CHARACTERS: CharacterEntry[] = classic

/** Sync lookup in whatever is already loaded (classic ± merged v3 extras). */
export function getCharacter(id: string): CharacterEntry | undefined {
  return byId.get(id)
}

/** True after HSK 3.0 extras have been merged into the catalog. */
export function isV3CatalogReady(): boolean {
  return v3Merged
}

/**
 * Lazy-load HSK 3.0-only characters (and merge into the live catalog).
 * Safe to call repeatedly; no-op once merged. Classic path must not call this.
 */
export function ensureV3Catalog(): Promise<void> {
  if (v3Merged) return Promise.resolve()
  if (!v3Promise) {
    v3Promise = import('./characters-v3-extra.json')
      .then((mod) => {
        const extra = mod.default as CharacterEntry[]
        const seen = new Set(catalog.map((e) => e.id))
        const merged = catalog.slice()
        for (const e of extra) {
          if (!seen.has(e.id)) {
            merged.push(e)
            seen.add(e.id)
          }
        }
        rebuildIndex(merged)
        v3Merged = true
      })
      .catch((err) => {
        v3Promise = null
        throw err
      })
  }
  return v3Promise
}

/** Ensure catalog covers the active HSK view (v3 → lazy extras). */
export function ensureCatalogForView(view: HskView): Promise<void> {
  if (view === 'v3') return ensureV3Catalog()
  return Promise.resolve()
}

/**
 * Resolve a character by id, loading HSK 3.0 extras if the id is missing
 * from the classic catalog (Practice deep-links).
 */
export async function ensureCharacterEntry(
  id: string,
): Promise<CharacterEntry | undefined> {
  const hit = byId.get(id)
  if (hit) return hit
  await ensureV3Catalog()
  return byId.get(id)
}
