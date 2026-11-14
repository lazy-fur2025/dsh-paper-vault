import {
  absoluteUrl,
  fetchText,
  linkHrefs,
  metaTags,
  normalizeDoi,
  stripTags,
} from './util.js'

/**
 * Best-effort metadata from a paper landing page: Highwire (`citation_*`), Open Graph
 * and Dublin Core tags, which most publishers and arXiv abstract pages expose.
 * The PDF URL is only used when the page itself advertises one.
 */
export async function pageMeta(url) {
  const html = await fetchText(url, {
    timeout: 30_000,
    maxBytes: 4_000_000,
    headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
  })
  const meta = metaTags(html)
  const first = (...names) => {
    for (const name of names) {
      const value = meta.get(name)?.[0]
      if (value) return value
    }
    return ''
  }
  const title = first('citation_title', 'og:title', 'twitter:title', 'dc.title') ||
    stripTags((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '')
  const authors = [
    ...(meta.get('citation_author') ?? []),
    ...(meta.get('dc.creator') ?? []),
  ].map((a) => a.trim()).filter(Boolean)
  const date = first('citation_publication_date', 'citation_date', 'dc.date', 'article:published_time')
  const year = (date.match(/\b(19|20)\d{2}\b/) ?? [])[0] ?? ''
  const doi = normalizeDoi(first('citation_doi', 'dc.identifier', 'prism.doi'))
  const pdfCandidate = first('citation_pdf_url') || linkHrefs(html, 'alternate', 'application/pdf')[0] || ''
  return {
    title,
    authors,
    year,
    venue: first('citation_journal_title', 'citation_conference_title', 'dc.source', 'og:site_name'),
    abstract: first('citation_abstract', 'dc.description', 'og:description', 'description'),
    doi,
    arxiv: normalizeArxivDoi(doi),
    url,
    pdfUrl: pdfCandidate ? absoluteUrl(url, pdfCandidate) ?? '' : '',
  }
}

function normalizeArxivDoi(doi) {
  return /^10\.48550\/arxiv\./i.test(doi) ? doi.replace(/^10\.48550\/arxiv\./i, '') : ''
}
