import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Practice from './pages/Practice'

/**
 * Vite `base: './'` → BASE_URL is `./` (relative). React Router wants no
 * basename at site root. Only set basename for absolute subpath bases.
 */
function routerBasename(): string | undefined {
  const raw = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'
  if (raw === '/' || raw === '.' || raw === '') return undefined
  return raw
}

export default function App() {
  return (
    <BrowserRouter basename={routerBasename()}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/practice/:id" element={<Practice />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
