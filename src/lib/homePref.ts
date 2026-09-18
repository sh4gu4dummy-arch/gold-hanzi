/** Home screen prefs: HSK view + difficulty (Strict / Dev unlocked). */

export type HskView = 'classic' | 'v3'
export type DifficultyMode = 'strict' | 'dev'

export const HSK_VIEW_KEY = 'chinese-trace:hsk-view:v1'
export const DIFFICULTY_KEY = 'chinese-trace:difficulty:v1'

export function getHskView(): HskView {
  try {
    const raw = localStorage.getItem(HSK_VIEW_KEY)
    if (raw === 'v3' || raw === 'classic') return raw
  } catch {
    /* ignore */
  }
  return 'classic'
}

export function setHskView(view: HskView): void {
  try {
    localStorage.setItem(HSK_VIEW_KEY, view)
  } catch {
    /* ignore */
  }
}

export function getDifficultyMode(): DifficultyMode {
  try {
    const raw = localStorage.getItem(DIFFICULTY_KEY)
    if (raw === 'strict' || raw === 'dev') return raw
  } catch {
    /* ignore */
  }
  return 'strict'
}

export function setDifficultyMode(mode: DifficultyMode): void {
  try {
    localStorage.setItem(DIFFICULTY_KEY, mode)
  } catch {
    /* ignore */
  }
}
