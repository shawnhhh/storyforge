/** Pure local lyrics structure analysis; never sends content to any provider. */
export interface LyricsSection {
  title: string
  line: number
  offset: number
}
export interface LyricsOutlineAnalysis {
  sections: LyricsSection[]
  lyricCharacters: number
  lyricLines: number
}

const sectionName = /^(?:主歌|副歌|预副歌|前副歌|桥段|前奏|间奏|尾奏|引子|独白|Verse|Chorus|Pre[ -]?Chorus|Bridge|Intro|Outro|Hook|Instrumental)(?:\s*(?:\d{1,2}|[一二三四五六七八九十]+|[A-D]))?$/iu

export function analyzeLyrics(text: string): LyricsOutlineAnalysis {
  if (!text) return { sections: [], lyricCharacters: 0, lyricLines: 0 }
  const lines = text.split(/\r\n|\n|\r/u)
  const delimiters = [...text.matchAll(/\r\n|\n|\r/gu)]
  const sections: LyricsSection[] = []
  let lyricCharacters = 0
  let lyricLines = 0
  let offset = 0
  lines.forEach((line, index) => {
    const heading = line.match(/^\s*\[([^\]\r\n]{1,32})\]\s*$/u)
    const title = heading?.[1].trim() ?? ''
    const isSection = Boolean(title && sectionName.test(title))
    if (isSection) sections.push({ title, line: index + 1, offset })
    else if (line.trim()) {
      lyricLines++
      lyricCharacters += Array.from(line.replace(/\s/gu, '')).length
    }
    offset += line.length + (delimiters[index]?.[0].length ?? 0)
  })
  return { sections, lyricCharacters, lyricLines }
}

export function lyricsTextFilename(title: string): string {
  const safe = Array.from(title, character => (/[<>:"/\\|?*]/u.test(character) || character.codePointAt(0)! < 32 || character.codePointAt(0) === 127) ? '_' : character).join('').trim().replace(/[. ]+$/gu, '').slice(0, 60)
  return (safe || 'music-lyrics') + '.txt'
}
