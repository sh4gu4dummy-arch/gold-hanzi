/** Mandarin (zh-CN) TTS via Web Speech API — never falls back to English. */

export type SpeakResult = 'ok' | 'no-voice' | 'unsupported' | 'skipped'

const VOICE_POLL_MS = 200
const VOICE_WAIT_MAX_MS = 2000

/** Lang tags commonly used for Mandarin / Chinese TTS. */
function isChineseLang(lang: string): boolean {
  const l = lang.toLowerCase().replace(/_/g, '-')
  return (
    l === 'zh' ||
    l.startsWith('zh-') ||
    l === 'cmn' ||
    l.startsWith('cmn-') ||
    l.includes('chinese') ||
    l.includes('mandarin') ||
    l.includes('putonghua')
  )
}

function isPreferredMandarin(lang: string): boolean {
  const l = lang.toLowerCase().replace(/_/g, '-')
  return (
    l === 'zh-cn' ||
    l === 'zh-hans' ||
    l.startsWith('zh-cn') ||
    l.startsWith('zh-hans') ||
    l.startsWith('cmn') ||
    l.includes('china')
  )
}

/** Common Chinese TTS voice display names (OS / browser quirks). */
function isChineseVoiceName(name: string): boolean {
  const n = name.toLowerCase().replace(/[\s_-]+/g, '')
  if (
    /tingting|meijia|yaoyao|huihui|xiaoxiao|sinji|sin\-?ji/.test(n) ||
    n.includes('tingting') ||
    n.includes('meijia') ||
    n.includes('yaoyao') ||
    n.includes('huihui') ||
    n.includes('xiaoxiao') ||
    n.includes('sinji')
  ) {
    return true
  }
  const raw = name.toLowerCase()
  if (
    /普通话|中文|chinese|mandarin|putonghua/.test(raw) ||
    /google.*(普通话|中文|chinese|mandarin|putonghua)/.test(raw) ||
    /microsoft.*(xiaoxiao|yaoyao|huihui|kangkang)/.test(raw)
  ) {
    return true
  }
  return false
}

function isChineseVoice(v: SpeechSynthesisVoice): boolean {
  return isChineseLang(v.lang) || isChineseVoiceName(v.name)
}

/** Pick the best native-sounding zh-CN / zh-Hans / named Chinese voice. */
export function pickChineseVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const chinese = voices.filter(isChineseVoice)
  if (chinese.length === 0) return null

  const preferred = chinese.filter(
    (v) => isPreferredMandarin(v.lang) || isChineseVoiceName(v.name),
  )
  const pool = preferred.length > 0 ? preferred : chinese

  // Prefer local / non-novelty names when ties exist.
  const scored = [...pool].sort((a, b) => {
    const score = (v: SpeechSynthesisVoice) => {
      let s = 0
      if (isPreferredMandarin(v.lang)) s += 10
      if (isChineseVoiceName(v.name)) s += 8
      if (v.localService) s += 3
      const n = v.name.toLowerCase()
      if (n.includes('premium') || n.includes('enhanced') || n.includes('neural'))
        s += 2
      if (
        n.includes('google') ||
        n.includes('tingting') ||
        n.includes('ting-ting') ||
        n.includes('xiaoxiao') ||
        n.includes('mei-jia') ||
        n.includes('meijia')
      )
        s += 1
      return s
    }
    return score(b) - score(a)
  })
  return scored[0] ?? null
}

/** Poll getVoices / voiceschanged until voices appear or ~2s elapses. */
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
      if (pollId != null) window.clearInterval(pollId)
      if (timeoutId != null) window.clearTimeout(timeoutId)
      resolve(synth.getVoices())
    }
    const onChange = () => {
      if (synth.getVoices().length > 0) finish()
    }
    synth.addEventListener('voiceschanged', onChange)
    const pollId = window.setInterval(() => {
      if (synth.getVoices().length > 0) finish()
    }, VOICE_POLL_MS)
    const timeoutId = window.setTimeout(finish, VOICE_WAIT_MAX_MS)
  })
}

/**
 * Speak a hanzi/string with a Chinese voice when available.
 * If no matched voice object but speechSynthesis exists, still speak with
 * utterance.lang = 'zh-CN' so the OS can pick a Chinese voice.
 * Cancels any in-flight utterance. Never intentionally uses an English voice.
 */
export async function speakHanzi(text: string): Promise<SpeakResult> {
  const trimmed = text.trim()
  if (!trimmed) return 'skipped'
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return 'unsupported'
  }

  const synth = window.speechSynthesis
  const voices = await loadVoices()
  const voice = pickChineseVoice(voices)

  // Only 'no-voice' when speak truly cannot be attempted.
  // With speechSynthesis present we always attempt zh-CN (OS may map a voice).
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(trimmed)
  if (voice) {
    utter.voice = voice
    utter.lang = voice.lang || 'zh-CN'
  } else {
    // Do not assign an English/default voice object — lang only.
    utter.lang = 'zh-CN'
  }
  utter.rate = 0.92
  utter.pitch = 1
  try {
    synth.speak(utter)
    return 'ok'
  } catch {
    return 'no-voice'
  }
}

export function cancelSpeech(): void {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
}
