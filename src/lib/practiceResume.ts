/** Persist last practice route so mobile minimize / cold start can resume. */

export const LAST_PRACTICE_KEY = 'chinese-trace:last-practice:v1'
/** sessionStorage: user chose Home this tab — do not auto-resume. */
export const SKIP_RESUME_KEY = 'chinese-trace:skip-resume:v1'

const PRACTICE_PATH_RE = /^\/practice\/([^/]+)$/

export function parsePracticePath(
  path: string | null | undefined,
): string | null {
  if (!path) return null
  const m = PRACTICE_PATH_RE.exec(path)
  return m?.[1] ? m[1] : null
}

export function getLastPracticePath(): string | null {
  try {
    const raw = localStorage.getItem(LAST_PRACTICE_KEY)
    if (!raw) return null
    return parsePracticePath(raw) ? raw : null
  } catch {
    return null
  }
}

export function setLastPracticePath(path: string): void {
  if (!parsePracticePath(path)) return
  try {
    localStorage.setItem(LAST_PRACTICE_KEY, path)
  } catch {
    /* ignore */
  }
}

export function clearLastPracticePath(): void {
  try {
    localStorage.removeItem(LAST_PRACTICE_KEY)
  } catch {
    /* ignore */
  }
}

/** User tapped Home — stay on Home for this tab session. */
export function markSkipResume(): void {
  try {
    sessionStorage.setItem(SKIP_RESUME_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function shouldSkipResume(): boolean {
  try {
    return sessionStorage.getItem(SKIP_RESUME_KEY) === '1'
  } catch {
    return false
  }
}

/** Clear skip after a successful practice land (optional hygiene). */
export function clearSkipResume(): void {
  try {
    sessionStorage.removeItem(SKIP_RESUME_KEY)
  } catch {
    /* ignore */
  }
}
