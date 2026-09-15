import { useState } from 'react'
import { getTheme, setTheme, type Theme } from '../lib/theme'

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getTheme())
  const isLight = theme === 'light'

  const onToggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      aria-pressed={isLight}
      onClick={onToggle}
    >
      {isLight ? 'Dark' : 'Light'}
    </button>
  )
}
