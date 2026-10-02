/** Persist Auto help on/off (arrow @3 fails, stroke replay @5). Default: on. */

export const AUTO_HELP_STORAGE_KEY = 'chinese-trace:auto-help-enabled:v1'

export function getAutoHelpEnabled(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_HELP_STORAGE_KEY)
    if (raw === '0' || raw === 'off') return false
    if (raw === '1' || raw === 'on') return true
  } catch {
    // private mode / blocked storage
  }
  return true
}

export function setAutoHelpEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_HELP_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}
