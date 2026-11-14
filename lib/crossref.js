import { fetchText, normalizeDoi, stripTags } from './util.js'

/** Crossref metadata for a DOI; no PDF link (publishers own access to that). */
export async function crossrefByDoi(doi) {
  const clean = normalizeDoi(doi)
  if (!clean) throw new Error(`not a DOI: ${doi}`)
  const body = await fetchText(`https://api.crossref.org/works/${encodeURIComponent(clean)}`, {
    timeout: 25_000,
    maxBytes: 2_000_000,
    headers: { accept: 'application/json' },
  })
  let message
  try {
    message = JSON.parse(body).message
  } catch {
    throw new Error(`Crossref returned invalid JSON for ${clean}`)
  }
  if (!message || typeof message !== 'object') throw new Error(`Crossref has no record for ${clean}`)

  const authors = Array.isArray(message.author)
    ? message.author
      .map((a) => {
        const family = String(a.family ?? a.name ?? '').trim()
        const given = String(a.given ?? '').trim()
        return family && given ? `${family}, ${given}` : family
      })
      .filter(Boolean)
    : []
  const year = yearOf(message)
  return {
    title: stripTags(Array.isArray(message.title) ? message.title[0] : message.title),
    authors,
    year,
    venue: stripTags(Array.isArray(message['container-title']) ? message['container-title'][0] : ''),
    abstract: stripTags(message.abstract ?? ''),
    doi: clean,
    arxiv: /^10\.48550\/arxiv\./i.test(clean) ? clean.replace(/^10\.48550\/arxiv\./i, '') : '',
    url: String(message.URL || `https://doi.org/${clean}`),
    pdfUrl: '',
  }
}

function yearOf(message) {
  const parts = [
    message.issued,
    message['published-print'],
    message['published-online'],
    message.created,
  ]
  for (const value of parts) {
    const year = value?.['date-parts']?.[0]?.[0]
    if (Number.isFinite(year)) return String(year)
  }
  return ''
}
