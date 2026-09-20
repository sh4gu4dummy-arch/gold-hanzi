/** Persist auto-advance to next level after clear. Default: on. */

export const AUTO_NEXT_STORAGE_KEY = 'chinese-trace:auto-next-level:v1'

export function getAutoNextLevel(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_NEXT_STORAGE_KEY)
    if (raw === '0' || raw === 'off') return false
    if (raw === '1' || raw === 'on') return true
  } catch {
    // private mode / blocked storage
  }
  return true
}

export function setAutoNextLevel(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_NEXT_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}
