/** Persist per-character level progress (and optional ink snapshots) in localStorage. */

const STORAGE_KEY = 'chinese-trace:progress:v1'

export type CharProgress = {
  /** 1-indexed levels that have been beaten. */
  beaten: number[]
  /** dataURL snapshots of ink canvas keyed by level string. */
  inkByLevel?: Record<string, string>
  /**
   * Unix ms when each beaten level was first cleared.
   * Sparse: only keys for levels that have a known clear time (legacy beaten
   * levels may lack an entry until cleared again after this field existed).
   */
  clearedAt?: Record<string, number>
}

export type ProgressStore = Record<string, CharProgress>

/** In-memory store — avoid re-parsing localStorage on every Home pill render. */
let memStore: ProgressStore | null = null
/** glyph → beaten.length; rebuilt lazily, invalidated on wipe / mark beaten. */
let beatenLenCache: Map<string, number> | null = null

function readStore(): ProgressStore {
  if (memStore) return memStore
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      memStore = {}
      return memStore
    }
    const parsed = JSON.parse(raw) as ProgressStore
    if (!parsed || typeof parsed !== 'object') {
      memStore = {}
      return memStore
    }
    memStore = parsed
    return memStore
  } catch {
    memStore = {}
    return memStore
  }
}

function writeStore(store: ProgressStore): void {
  memStore = store
  beatenLenCache = null
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota / private mode — ignore.
  }
}

/** Drop caches so the next read re-parses / rebuilds (tests / rare external writes). */
export function invalidateProgressCache(): void {
  memStore = null
  beatenLenCache = null
}

function normalizeClearedAt(
  raw: unknown,
): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      out[k] = Math.floor(v)
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeEntry(entry: CharProgress | undefined): CharProgress {
  if (!entry || !Array.isArray(entry.beaten)) {
    return { beaten: [], inkByLevel: {} }
  }
  const beaten = entry.beaten
    .filter((n) => typeof n === 'number' && n >= 1)
    .map((n) => Math.floor(n))
  const inkByLevel: Record<string, string> = {}
  if (entry.inkByLevel && typeof entry.inkByLevel === 'object') {
    for (const [k, v] of Object.entries(entry.inkByLevel)) {
      if (typeof v === 'string' && v.startsWith('data:')) {
        inkByLevel[k] = v
      }
    }
  }
  const clearedAt = normalizeClearedAt(entry.clearedAt)
  const next: CharProgress = { beaten, inkByLevel }
  if (clearedAt) next.clearedAt = clearedAt
  return next
}

function ensureBeatenLenCache(): Map<string, number> {
  if (beatenLenCache) return beatenLenCache
  const store = readStore()
  const map = new Map<string, number>()
  for (const [ch, entry] of Object.entries(store)) {
    map.set(ch, normalizeEntry(entry).beaten.length)
  }
  beatenLenCache = map
  return map
}

export function getCharProgress(character: string): CharProgress {
  return normalizeEntry(readStore()[character])
}

export function isLevelBeaten(character: string, level: number): boolean {
  return getCharProgress(character).beaten.includes(level)
}

/** Unix ms first-clear time for a level, or null if unbeaten / legacy without stamp. */
export function getLevelClearedAt(
  character: string,
  level: number,
): number | null {
  const t = getCharProgress(character).clearedAt?.[String(level)]
  return typeof t === 'number' ? t : null
}

/** Level L unlocked if L===1 or L-1 is beaten. */
export function isLevelUnlocked(character: string, level: number): boolean {
  if (level <= 1) return true
  return isLevelBeaten(character, level - 1)
}

export function highestUnlocked(character: string, levelCount: number): number {
  let max = 1
  for (let L = 1; L <= levelCount; L++) {
    if (isLevelUnlocked(character, L)) max = L
    else break
  }
  return max
}

/** Cached beaten-level count — safe to call thousands of times per Home render. */
export function beatenCount(character: string): number {
  return ensureBeatenLenCache().get(character) ?? 0
}

export function getLevelInk(character: string, level: number): string | null {
  const ink = getCharProgress(character).inkByLevel?.[String(level)]
  return typeof ink === 'string' ? ink : null
}

export function saveLevelInk(
  character: string,
  level: number,
  dataUrl: string,
): CharProgress {
  const store = readStore()
  const current = normalizeEntry(store[character])
  const inkByLevel = { ...current.inkByLevel, [String(level)]: dataUrl }
  const next: CharProgress = {
    beaten: current.beaten,
    inkByLevel,
  }
  if (current.clearedAt) next.clearedAt = current.clearedAt
  store[character] = next
  writeStore(store)
  return next
}

export function clearLevelInk(character: string, level: number): CharProgress {
  const store = readStore()
  const current = normalizeEntry(store[character])
  const inkByLevel = { ...current.inkByLevel }
  delete inkByLevel[String(level)]
  const next: CharProgress = {
    beaten: current.beaten,
    inkByLevel,
  }
  if (current.clearedAt) next.clearedAt = current.clearedAt
  store[character] = next
  writeStore(store)
  return next
}

export function markLevelBeaten(
  character: string,
  level: number,
  inkDataUrl?: string,
): CharProgress {
  const store = readStore()
  const current = normalizeEntry(store[character])
  const beaten = new Set(current.beaten)
  beaten.add(level)
  const inkByLevel = { ...current.inkByLevel }
  if (inkDataUrl) {
    inkByLevel[String(level)] = inkDataUrl
  }
  const clearedAt: Record<string, number> = { ...(current.clearedAt ?? {}) }
  const key = String(level)
  // First clear wins; do not overwrite if already stamped (re-practice / re-mark).
  if (clearedAt[key] == null) {
    clearedAt[key] = Date.now()
  }
  const next: CharProgress = {
    beaten: [...beaten].sort((a, b) => a - b),
    inkByLevel,
    clearedAt,
  }
  store[character] = next
  writeStore(store)
  return next
}

export { STORAGE_KEY }

/** Remove one character's progress + ink. Does not touch theme or other keys. */
export function clearCharProgress(character: string): void {
  const store = readStore()
  delete store[character]
  writeStore(store)
}

/** Empty the progress store. Does not touch theme or other keys. */
export function clearAllProgress(): void {
  writeStore({})
}
