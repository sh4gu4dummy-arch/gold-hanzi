import { pinyin } from 'pinyin-pro'

const cache = new Map<string, string>()

/**
 * Tone-marked pinyin for a Simplified phrase (space-separated syllables).
 * Derived at runtime so catalogs need only store phrase hanzi.
 */
export function phraseToPinyin(phrase: string): string {
  const key = phrase.trim()
  if (!key) return ''
  const hit = cache.get(key)
  if (hit != null) return hit
  const out = pinyin(key, { toneType: 'symbol' }).trim()
  cache.set(key, out)
  return out
}
