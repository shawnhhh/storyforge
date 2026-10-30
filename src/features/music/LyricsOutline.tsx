import { useMemo } from 'react'
import { analyzeLyrics, lyricsTextFilename } from './lyrics-outline.js'
import './lyrics-outline.css'

export function LyricsOutline({ text, title, onJump }: { text: string; title: string; onJump: (offset: number) => void }) {
  const analysis = useMemo(() => analyzeLyrics(text), [text])
  function exportText() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = lyricsTextFilename(title)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="lyrics-outline" aria-label="歌词结构导航">
    <div className="lyrics-outline-header">
      <strong>歌词结构</strong>
      <span className="music-note">{analysis.lyricCharacters} 字 · {analysis.lyricLines} 行 · {analysis.sections.length} 段</span>
      <button type="button" onClick={exportText} disabled={!text} aria-label="将当前歌词导出为 TXT">导出歌词 TXT</button>
    </div>
    {analysis.sections.length ? <nav className="lyrics-outline-sections" aria-label="跳转歌词段落">
      {analysis.sections.map((section, index) => <button key={section.offset} type="button"
        onClick={() => onJump(section.offset)}
        title={`跳转到第 ${section.line} 行`}>
        <span className="lyrics-outline-index">{String(index + 1).padStart(2, '0')}</span>
        {section.title}
      </button>)}
    </nav> : <p className="music-note">用 [主歌]、[副歌]、[桥段] 或 [Verse 1] 标记歌词，即可快速跳转；不修改正文。</p>}
    <p className="music-note lyrics-outline-hint">仅在本地分析；TXT 导出包含当前编辑内容（即使尚未保存），不包含音频素材。</p>
  </section>
}
