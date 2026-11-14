import { attr, fetchText, normalizeArxivId, stripTags } from './util.js'

const API = 'https://export.arxiv.org/api/query'

/** Ranked arXiv search. Returns metadata only; importing is a separate call. */
export async function searchArxiv(query, max = 5) {
  const url = `${API}?search_query=${encodeURIComponent(`all:${query}`)}` +
    `&start=0&max_results=${Math.max(1, Math.min(20, max))}` +
    '&sortBy=relevance&sortOrder=descending'
  const xml = await fetchText(url, { timeout: 25_000, maxBytes: 3_000_000 })
  return parseEntries(xml)
}

/** Metadata for one id (the Atom feed's single entry). Throws when arXiv knows no such id. */
export async function arxivById(id) {
  const clean = normalizeArxivId(id)
  if (!clean) throw new Error(`not an arXiv id: ${id}`)
  const xml = await fetchText(`${API}?id_list=${encodeURIComponent(clean)}`, {
    timeout: 25_000,
    maxBytes: 1_500_000,
  })
  const [paper] = parseEntries(xml)
  if (!paper) throw new Error(`arXiv returned no paper for ${clean}`)
  return paper
}

export function arxivPdfUrl(id) {
  const clean = normalizeArxivId(id)
  return clean ? `https://arxiv.org/pdf/${clean}` : ''
}

function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))
  return m ? stripTags(m[1]) : ''
}

/** Parse the arXiv Atom feed (works for search results and `id_list` answers). */
export function parseEntries(xml) {
  const entries = []
  for (const match of String(xml ?? '').matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const entry = match[0]
    const title = tag(entry, 'title')
    if (!title) continue
    const idUrl = tag(entry, 'id')
    const arxivId = normalizeArxivId(idUrl)
    const published = tag(entry, 'published') || tag(entry, 'updated')
    const authors = []
    for (const a of entry.matchAll(/<author\b[\s\S]*?<\/author>/gi)) {
      const name = tag(a[0], 'name')
      if (name) authors.push(name)
    }
    let pdfUrl = ''
    for (const link of entry.matchAll(/<link\b[^>]*>/gi)) {
      const href = attr(link[0], 'href')
      const titleAttr = attr(link[0], 'title').toLowerCase()
      if (href && (titleAttr === 'pdf' || /\/pdf\//.test(href))) {
        pdfUrl = href
        break
      }
    }
    const doi = tag(entry, 'arxiv:doi') || tag(entry, 'doi')
    entries.push({
      arxivId,
      title,
      authors,
      year: published.slice(0, 4),
      published,
      venue: 'arXiv',
      abstract: tag(entry, 'summary'),
      doi,
      url: arxivId ? `https://arxiv.org/abs/${arxivId}` : idUrl,
      pdfUrl: pdfUrl || (arxivId ? arxivPdfUrl(arxivId) : ''),
    })
  }
  return entries
}
