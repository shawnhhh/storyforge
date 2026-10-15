import type { PlanningSnapshot } from '../../../../shared/contracts/planning.js'
import type { RichTextNode } from '../../../../shared/contracts/novels.js'
import { HttpError, NovelStore } from './store.js'

export function safeFilename(title: string) {
  const cleaned = Array.from(title.normalize('NFC')).map(char => {
    const point = char.codePointAt(0)!
    return point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff) || '/\\:*?"<>|'.includes(char) ? '_' : char
  }).join('').replace(/^[. ]+|[. ]+$/g, '')
  return Array.from(cleaned).slice(0, 100).join('') || '小说'
}
function escapeMarkdown(value: string) { return value.replace(/[\\`*_{}[\]()#+.!<>~|-]/g, '\\$&') }

// Render the actual StarterKit JSON tree; never flatten HTML with a regex.
export function renderRichText(node: RichTextNode, markdown: boolean): string {
  const children = () => (node.content ?? []).map(child => renderRichText(child, markdown)).join('')
  if (node.type === 'text') {
    let value = markdown ? escapeMarkdown(node.text ?? '') : node.text ?? ''
    if (markdown) for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') value = `**${value}**`
      if (mark.type === 'italic') value = `*${value}*`
      if (mark.type === 'strike') value = `~~${value}~~`
      if (mark.type === 'code') {
        const raw = node.text ?? '', fence = '`'.repeat(Math.max(1, ...(raw.match(/`+/g) ?? []).map(run => run.length + 1)))
        value = `${fence} ${raw} ${fence}`
      }
      if (mark.type === 'link' && typeof mark.attrs?.href === 'string') value = `[${value}](<${mark.attrs.href.replace(/[<>\s]/g, char => encodeURIComponent(char))}>)`
    }
    return value
  }
  switch (node.type) {
    case 'doc': case 'listItem': return children()
    case 'paragraph': return children() + '\n\n'
    case 'heading': return (markdown ? '#'.repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))) + ' ' : '') + children() + '\n\n'
    case 'hardBreak': return markdown ? '  \n' : '\n'
    case 'bulletList': case 'orderedList': {
      return (node.content ?? []).map((item, index) => {
        const prefix = node.type === 'bulletList' ? '- ' : `${Number(node.attrs?.start ?? 1) + index}. `
        const lines = renderRichText(item, markdown).trimEnd().split('\n')
        return prefix + lines.map((line, i) => i ? ' '.repeat(prefix.length) + line : line).join('\n')
      }).join('\n') + '\n\n'
    }
    case 'blockquote': return children().trimEnd().split('\n').map(line => '> ' + line).join('\n') + '\n\n'
    case 'horizontalRule': return '---\n\n'
    case 'codeBlock': {
      const raw = (node.content ?? []).map(item => item.text ?? '').join('')
      const fence = '`'.repeat(Math.max(3, ...(raw.match(/`+/g) ?? []).map(run => run.length + 1)))
      const language = String(node.attrs?.language ?? '').replace(/[^a-zA-Z0-9_+-]/g, '')
      return markdown ? `${fence}${language}\n${raw}\n${fence}\n\n` : raw + '\n\n'
    }
    default: return children()
  }
}
export function exportNovel(store: NovelStore, id: string, format: unknown, planning?: PlanningSnapshot) {
  if (format !== 'markdown' && format !== 'txt' && format !== 'json') throw new HttpError(400, '请选择 Markdown、TXT 或 JSON')
  const { novel, chapters } = store.exportData(id)
  const extension = format === 'markdown' ? 'md' : format
  let body: string
  if (format === 'json') body = JSON.stringify({ format: 'storyforge-novel', formatVersion: 1, exportedAt: new Date().toISOString(), novel, chapters, ...(planning ? { planning } : {}) }, null, 2) + '\n'
  else {
    const md = format === 'markdown', title = (value: string) => md ? escapeMarkdown(value) : value
    body = `${md ? '# ' : ''}${title(novel.title)}\n\n`
    if (novel.description) body += title(novel.description) + '\n\n'
    body += chapters.map(chapter => `${md ? '## ' : ''}${title(chapter.title)}\n\n${renderRichText(chapter.content, md).trimEnd()}\n`).join('\n')
  }
  return { body, extension, filename: `${safeFilename(novel.title)}.${extension}`, mime: format === 'json' ? 'application/json; charset=utf-8' : format === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8' }
}
