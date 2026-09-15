/** Persist per-character level progress in localStorage. */

const STORAGE_KEY = 'chinese-trace:progress:v1'

export type CharProgress = {
  /** 1-indexed levels that have been beaten. */
  beaten: number[]
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

export function getCharProgress(character: string): CharProgress {
  const entry = readStore()[character]
  if (!entry || !Array.isArray(entry.beaten)) return { beaten: [] }
  return {
    beaten: entry.beaten
      .filter((n) => typeof n === 'number' && n >= 1)
      .map((n) => Math.floor(n)),
  }
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

export function markLevelBeaten(character: string, level: number): CharProgress {
  const store = readStore()
  const current = store[character] ?? { beaten: [] }
  const beaten = new Set(current.beaten)
  beaten.add(level)
  const next: CharProgress = {
    beaten: [...beaten].sort((a, b) => a - b),
  }
  store[character] = next
  writeStore(store)
  return next
}

export { STORAGE_KEY }
