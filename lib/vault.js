import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizeTitle, shortHash, slug, truncate } from './util.js'

const CATALOG_VERSION = 1

/** The local-first vault: one catalog JSON, PDFs and Markdown notes on disk. */
export class PaperVault {
  constructor(root) {
    this.root = root
    this.catalogFile = path.join(root, 'catalog.json')
    this.pdfDir = path.join(root, 'pdfs')
    this.noteDir = path.join(root, 'notes')
  }

  async init() {
    await mkdir(this.pdfDir, { recursive: true })
    await mkdir(this.noteDir, { recursive: true })
    try {
      await readFile(this.catalogFile, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await this.save({ version: CATALOG_VERSION, papers: [] })
    }
  }

  async load() {
    const text = await readFile(this.catalogFile, 'utf8')
    const parsed = JSON.parse(text)
    const papers = Array.isArray(parsed?.papers) ? parsed.papers.filter((p) => p && p.id && p.title) : []
    return { version: CATALOG_VERSION, papers }
  }

  async save(catalog) {
    const text = `${JSON.stringify({ version: CATALOG_VERSION, papers: catalog.papers }, null, 2)}\n`
    const temp = `${this.catalogFile}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, text, 'utf8')
    await rename(temp, this.catalogFile)
  }

  async list({ query = '', tag = '', unread = false, limit = 20 } = {}) {
    const catalog = await this.load()
    const q = normalizeTitle(query)
    const wantedTag = String(tag).trim().toLowerCase()
    const rows = catalog.papers
      .filter((paper) => {
        if (unread && paper.read) return false
        if (wantedTag && !(paper.tags ?? []).some((t) => String(t).toLowerCase() === wantedTag)) return false
        if (!q) return true
        const haystack = normalizeTitle([
          paper.title, paper.venue, paper.doi, paper.arxiv, ...(paper.authors ?? []), ...(paper.tags ?? []),
        ].join(' '))
        return haystack.includes(q)
      })
      .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))
    return {
      total: catalog.papers.length,
      matches: rows.length,
      papers: rows.slice(0, Math.max(1, Math.min(50, limit))),
    }
  }

  async find(ref) {
    const catalog = await this.load()
    return this.lookup(catalog, ref)
  }

  lookup(catalog, ref) {
    const value = String(ref ?? '').trim()
    if (!value) return null
    const lower = value.toLowerCase()
    const norm = normalizeTitle(value)
    for (const paper of catalog.papers) {
      if (paper.id === value) return paper
      if (paper.arxiv && String(paper.arxiv).toLowerCase() === lower) return paper
      if (paper.doi && String(paper.doi).toLowerCase() === lower) return paper
    }
    if (norm.length >= 4) {
      return catalog.papers.find((paper) => normalizeTitle(paper.title).includes(norm)) ?? null
    }
    return null
  }

  /** Assign a stable id before writing: arXiv id > DOI > title slug. */
  idFor(meta) {
    if (meta.arxiv) return `arxiv-${String(meta.arxiv).replace(/[^a-z0-9.-]+/gi, '_')}`
    if (meta.doi) return `doi-${slug(meta.doi, 40)}-${shortHash(meta.doi, 6)}`
    return `paper-${slug(meta.title, 36)}-${shortHash(meta.title, 6)}`
  }

  /** Insert or merge one paper. Returns the stored record and whether it already existed. */
  async upsert(meta) {
    const catalog = await this.load()
    const existing = this.lookup(catalog, meta.arxiv || meta.doi || meta.title)
    const now = new Date().toISOString()
    if (existing) {
      merge(existing, meta)
      existing.updatedAt = now
      await this.save(catalog)
      return { paper: existing, duplicate: true }
    }
    let id = this.idFor(meta)
    if (catalog.papers.some((paper) => paper.id === id)) id = `${id}-${shortHash(meta.title, 4)}`
    const paper = {
      id,
      title: String(meta.title ?? '').trim(),
      authors: Array.isArray(meta.authors) ? meta.authors.filter(Boolean) : [],
      year: String(meta.year ?? ''),
      venue: String(meta.venue ?? ''),
      abstract: String(meta.abstract ?? ''),
      doi: String(meta.doi ?? ''),
      arxiv: String(meta.arxiv ?? ''),
      url: String(meta.url ?? ''),
      pdf: '',
      tags: [],
      read: false,
      addedAt: now,
      updatedAt: now,
    }
    catalog.papers.push(paper)
    await this.save(catalog)
    return { paper, duplicate: false }
  }

  pdfPath(paper) {
    return paper?.pdf ? path.join(this.root, paper.pdf) : ''
  }

  notePath(paper) {
    return path.join(this.noteDir, `${paper.id}.md`)
  }

  /** Store a downloaded PDF for [id] and point the catalog row at it. */
  async attachPdf(id, bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 5 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error('downloaded file is not a PDF')
    }
    const catalog = await this.load()
    const paper = catalog.papers.find((row) => row.id === id)
    if (!paper) throw new Error(`no paper ${id}`)
    const relative = `pdfs/${id}.pdf`
    const target = path.join(this.root, relative)
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, bytes)
    await rename(temp, target)
    paper.pdf = relative
    paper.updatedAt = new Date().toISOString()
    await this.save(catalog)
    return paper
  }

  async update(ref, { addTags = [], removeTags = [], read } = {}) {
    const catalog = await this.load()
    const paper = this.lookup(catalog, ref)
    if (!paper) throw new Error(`no paper matches ${JSON.stringify(ref)}`)
    const tags = new Set((paper.tags ?? []).map((t) => String(t).trim()).filter(Boolean))
    const remove = new Set(removeTags.map((t) => String(t).trim().toLowerCase()))
    for (const tag of [...tags]) if (remove.has(tag.toLowerCase())) tags.delete(tag)
    for (const tag of addTags.map((t) => String(t).trim()).filter(Boolean)) {
      if (![...tags].some((t) => t.toLowerCase() === tag.toLowerCase())) tags.add(tag)
    }
    paper.tags = [...tags]
    if (typeof read === 'boolean') paper.read = read
    paper.updatedAt = new Date().toISOString()
    await this.save(catalog)
    return paper
  }

  async readNote(ref) {
    const paper = await this.find(ref)
    if (!paper) throw new Error(`no paper matches ${JSON.stringify(ref)}`)
    const text = await readFile(this.notePath(paper), 'utf8').catch(() => '')
    return { paper, text, path: relative(this.root, this.notePath(paper)) }
  }

  async writeNote(ref, text, { append = false } = {}) {
    const paper = await this.find(ref)
    if (!paper) throw new Error(`no paper matches ${JSON.stringify(ref)}`)
    const file = this.notePath(paper)
    const incoming = String(text ?? '')
    const previous = append ? await readFile(file, 'utf8').catch(() => '') : ''
    const body = append && previous.trim()
      ? `${previous.trimEnd()}\n\n${incoming.trimStart()}`
      : incoming
    await mkdir(this.noteDir, { recursive: true })
    await writeFile(file, body, 'utf8')
    paper.updatedAt = new Date().toISOString()
    const catalog = await this.load()
    const stored = catalog.papers.find((row) => row.id === paper.id)
    if (stored) {
      stored.updatedAt = paper.updatedAt
      await this.save(catalog)
    }
    return { paper, text: body, path: relative(this.root, file) }
  }

  /** Full-text search across the notes/ Markdown files, one hit per note. */
  async searchNotes(query, limit = 20) {
    const q = String(query ?? '').trim()
    if (!q) throw new Error('query is required')
    const needle = q.toLowerCase()
    const files = (await readdir(this.noteDir).catch(() => []))
      .filter((name) => name.endsWith('.md'))
      .sort()
    const catalog = await this.load()
    const hits = []
    for (const name of files) {
      if (hits.length >= Math.max(1, Math.min(50, limit))) break
      const file = path.join(this.noteDir, name)
      const body = await readFile(file, 'utf8').catch(() => '')
      const id = name.slice(0, -3)
      const paper = catalog.papers.find((row) => row.id === id)
      const title = paper?.title ?? id
      const at = body.toLowerCase().indexOf(needle)
      const titleHit = title.toLowerCase().includes(needle) || id.toLowerCase().includes(needle)
      if (!titleHit && at < 0) continue
      const start = at < 0 ? 0 : Math.max(0, at - 90)
      hits.push({
        paperId: id,
        title,
        path: `notes/${name}`,
        excerpt: truncate(body.slice(start, start + 260).replace(/\s+/g, ' '), 240),
      })
    }
    return { query: q, notes: hits }
  }
}

function merge(paper, meta) {
  const fields = ['title', 'year', 'venue', 'abstract', 'doi', 'arxiv', 'url']
  for (const key of fields) {
    const value = String(meta[key] ?? '').trim()
    if (value && !String(paper[key] ?? '').trim()) paper[key] = value
  }
  if ((!paper.authors || paper.authors.length === 0) && Array.isArray(meta.authors)) {
    paper.authors = meta.authors.filter(Boolean)
  }
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}
