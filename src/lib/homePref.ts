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

export const SOUND_TIP_KEY = 'chinese-trace:sound-tip-seen:v1'

export function getSoundTipSeen(): boolean {
  try {
    return localStorage.getItem(SOUND_TIP_KEY) === '1'
  } catch {
    return false
  }
}

export function setSoundTipSeen(): void {
  try {
    localStorage.setItem(SOUND_TIP_KEY, '1')
  } catch {
    /* ignore */
  }
}


export const PHRASE_PANEL_KEY = 'chinese-trace:phrase-panel-open:v1'

/** Practice context-phrase panel; default collapsed. */
export function getPhrasePanelOpen(): boolean {
  try {
    return localStorage.getItem(PHRASE_PANEL_KEY) === '1'
  } catch {
    return false
  }
}

export function setPhrasePanelOpen(open: boolean): void {
  try {
    localStorage.setItem(PHRASE_PANEL_KEY, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}
