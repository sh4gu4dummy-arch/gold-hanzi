/** Persist per-character level progress (and optional ink snapshots) in localStorage. */

const STORAGE_KEY = 'chinese-trace:progress:v1'

export type CharProgress = {
  /** 1-indexed levels that have been beaten. */
  beaten: number[]
  /** dataURL snapshots of ink canvas keyed by level string. */
  inkByLevel?: Record<string, string>
}

export type ProgressStore = Record<string, CharProgress>

function readStore(): ProgressStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ProgressStore
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

function writeStore(store: ProgressStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota / private mode — ignore.
  }
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
  return { beaten, inkByLevel }
}

export function getCharProgress(character: string): CharProgress {
  return normalizeEntry(readStore()[character])
}

export function isLevelBeaten(character: string, level: number): boolean {
  return getCharProgress(character).beaten.includes(level)
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

export function beatenCount(character: string): number {
  return getCharProgress(character).beaten.length
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
  const next: CharProgress = {
    beaten: [...beaten].sort((a, b) => a - b),
    inkByLevel,
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
