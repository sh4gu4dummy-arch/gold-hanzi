/** Mandarin (zh-CN) TTS via Web Speech API — never falls back to English. */

export type SpeakResult = 'ok' | 'no-voice' | 'unsupported' | 'skipped'

function isChineseLang(lang: string): boolean {
  const l = lang.toLowerCase().replace('_', '-')
  return (
    l === 'zh' ||
    l.startsWith('zh-') ||
    l.includes('chinese')
  )
}

function isPreferredMandarin(lang: string): boolean {
  const l = lang.toLowerCase().replace('_', '-')
  return (
    l === 'zh-cn' ||
    l === 'zh-hans' ||
    l.startsWith('zh-cn') ||
    l.startsWith('zh-hans') ||
    l.includes('china')
  )
}

/** Pick the best native-sounding zh-CN / zh-Hans voice. */
export function pickChineseVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const chinese = voices.filter((v) => isChineseLang(v.lang))
  if (chinese.length === 0) return null

  const preferred = chinese.filter((v) => isPreferredMandarin(v.lang))
  const pool = preferred.length > 0 ? preferred : chinese

  // Prefer local / non-novelty names when ties exist.
  const scored = [...pool].sort((a, b) => {
    const score = (v: SpeechSynthesisVoice) => {
      let s = 0
      if (isPreferredMandarin(v.lang)) s += 10
      if (v.localService) s += 3
      const n = v.name.toLowerCase()
      if (n.includes('premium') || n.includes('enhanced') || n.includes('neural'))
        s += 2
      if (n.includes('google') || n.includes('tingting') || n.includes('xiaoxiao'))
        s += 1
      return s
    }
    return score(b) - score(a)
  })
  return scored[0] ?? null
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return Promise.resolve([])
  }
  const synth = window.speechSynthesis
  const existing = synth.getVoices()
  if (existing.length > 0) return Promise.resolve(existing)

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      synth.removeEventListener('voiceschanged', onChange)
      resolve(synth.getVoices())
    }
    const onChange = () => finish()
    synth.addEventListener('voiceschanged', onChange)
    window.setTimeout(finish, 600)
  })
}

/** Speak a hanzi/string with a Chinese voice only. Cancels any in-flight utterance. */
export async function speakHanzi(text: string): Promise<SpeakResult> {
  const trimmed = text.trim()
  if (!trimmed) return 'skipped'
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return 'unsupported'
  }

  const voices = await loadVoices()
  const voice = pickChineseVoice(voices)
  if (!voice) return 'no-voice'

  const synth = window.speechSynthesis
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(trimmed)
  utter.voice = voice
  utter.lang = voice.lang || 'zh-CN'
  utter.rate = 0.92
  utter.pitch = 1
  synth.speak(utter)
  return 'ok'
}

export function cancelSpeech(): void {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
}
