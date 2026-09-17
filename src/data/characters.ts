export type CharacterEntry = {
  id: string
  character: string
  pinyin: string
  meaning: string
}

/** Top 20 most commonly used Simplified Chinese characters (Jun Da frequency). */
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
  { id: 'zhe', character: '这', pinyin: 'zhè', meaning: 'this / these' },
  { id: 'ge', character: '个', pinyin: 'gè', meaning: 'measure word / individual' },
  { id: 'men', character: '们', pinyin: 'men', meaning: 'plural marker' },
  { id: 'zhong', character: '中', pinyin: 'zhōng', meaning: 'middle / in / China' },
  { id: 'lai', character: '来', pinyin: 'lái', meaning: 'come' },
  { id: 'shang', character: '上', pinyin: 'shàng', meaning: 'on / up / last' },
  { id: 'da', character: '大', pinyin: 'dà', meaning: 'big / large' },
  { id: 'wei', character: '为', pinyin: 'wèi', meaning: 'for / to be' },
  { id: 'he', character: '和', pinyin: 'hé', meaning: 'and / with / peace' },
  { id: 'guo', character: '国', pinyin: 'guó', meaning: 'country / nation' },
]

export function getCharacter(id: string): CharacterEntry | undefined {
  return CHARACTERS.find((entry) => entry.id === id)
}
