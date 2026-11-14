import { normalizeTitle, slug } from './util.js'

/** BibTeX for local papers; stable keys (surname + year + title word, suffix a/b on collisions). */
export function bibtex(papers, limit = 100) {
  const used = new Set()
  return papers.slice(0, Math.max(1, limit)).map((paper) => entry(paper, used)).join('\n\n')
}

function entry(paper, used) {
  const arxiv = String(paper.arxiv ?? '').trim()
  const type = arxiv ? 'misc' : (paper.venue ? 'article' : 'misc')
  const fields = [
    ['title', tex(paper.title)],
    ['author', authorList(paper.authors)],
  ]
  if (paper.venue && !arxiv) fields.push(['journal', tex(paper.venue)])
  if (paper.year) fields.push(['year', String(paper.year)])
  if (paper.doi) fields.push(['doi', tex(paper.doi)])
  if (arxiv) {
    fields.push(['eprint', tex(arxiv)], ['archivePrefix', 'arXiv'])
  }
  if (paper.url) fields.push(['url', tex(paper.url)])
  const body = fields
    .filter(([, value]) => value)
    .map(([key, value]) => `  ${key} = {${value}}`)
    .join(',\n')
  return `@${type}{${keyFor(paper, used)},\n${body}\n}`
}

function keyFor(paper, used) {
  const first = String(paper.authors?.[0] ?? '').trim()
  const surname = first.includes(',') ? first.split(',')[0] : (first.split(/\s+/).pop() ?? '')
  const word = normalizeTitle(paper.title).split(' ').find((part) => part.length > 2) ?? 'paper'
  const base = `${slug(surname || 'paper', 16)}${paper.year || ''}${slug(word, 16)}`
  let key = base
  let n = 1
  while (used.has(key)) {
    key = `${base}${String.fromCharCode(96 + (++n))}`
  }
  used.add(key)
  return key
}

function authorList(authors) {
  if (!Array.isArray(authors)) return ''
  return authors
    .map((author) => {
      const value = String(author).trim()
      if (!value) return ''
      if (value.includes(',')) return tex(value)
      const parts = value.split(/\s+/)
      const last = parts.pop()
      return parts.length ? `${tex(last)}, ${tex(parts.join(' '))}` : tex(last)
    })
    .filter(Boolean)
    .join(' and ')
}

/** Keep LaTeX braces meaningful but neutralise the characters that would end a field. */
function tex(value) {
  return String(value ?? '')
    .replace(/(?<!\\)([{}])/g, '\\$1')
    .replace(/\s+/g, ' ')
    .trim()
}
