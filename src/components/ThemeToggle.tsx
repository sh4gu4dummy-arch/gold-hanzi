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
      title={isLight ? 'Dark mode' : 'Light mode'}
      onClick={onToggle}
    >
      {/* Show the mode you switch TO (common app pattern), as a symbol */}
      <span className="theme-toggle-icon" aria-hidden="true">
        {isLight ? '🌙' : '☀️'}
      </span>
    </button>
  )
}
