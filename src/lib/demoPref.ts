/** Persist Demo on/off (animated stroke-order playback). Default: on. */

export const DEMO_STORAGE_KEY = 'chinese-trace:demo-enabled:v1'

export function getDemoEnabled(): boolean {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY)
    if (raw === '0' || raw === 'off') return false
    if (raw === '1' || raw === 'on') return true
  } catch {
    // private mode / blocked storage
  }
  return true
}

export function setDemoEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}
