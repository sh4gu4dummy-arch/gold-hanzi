export type CharacterEntry = {
  id: string
  character: string
  pinyin: string
  meaning: string
}

/** Top 10 most commonly used Simplified Chinese characters. */
export const CHARACTERS: CharacterEntry[] = [
  { id: 'de', character: '的', pinyin: 'de', meaning: 'possessive particle' },
  { id: 'yi', character: '一', pinyin: 'yī', meaning: 'one' },
  { id: 'shi', character: '是', pinyin: 'shì', meaning: 'to be' },
  { id: 'le', character: '了', pinyin: 'le', meaning: 'completed action' },
  { id: 'wo', character: '我', pinyin: 'wǒ', meaning: 'I / me' },
  { id: 'bu', character: '不', pinyin: 'bù', meaning: 'not' },
  { id: 'zai', character: '在', pinyin: 'zài', meaning: 'at / in' },
  { id: 'ren', character: '人', pinyin: 'rén', meaning: 'person' },
  { id: 'you', character: '有', pinyin: 'yǒu', meaning: 'to have' },
  { id: 'ta', character: '他', pinyin: 'tā', meaning: 'he / him' },
]

export function getCharacter(id: string): CharacterEntry | undefined {
  return CHARACTERS.find((entry) => entry.id === id)
}
