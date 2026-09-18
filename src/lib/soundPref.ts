/** Persist Sound on/off (Mandarin TTS). Default: on. */

export const SOUND_STORAGE_KEY = 'chinese-trace:sound-enabled:v1'

export function getSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SOUND_STORAGE_KEY)
    if (raw === '0' || raw === 'off') return false
    if (raw === '1' || raw === 'on') return true
  } catch {
    // private mode / blocked storage
  }
  return true
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}
