import os from 'node:os'
import path from 'node:path'
import { arxivById, arxivPdfUrl, searchArxiv } from './lib/arxiv.js'
import { bibtex } from './lib/bibtex.js'
import { crossrefByDoi } from './lib/crossref.js'
import { fetchBytes, normalizeArxivId, normalizeDoi, pdfInfo, truncate } from './lib/util.js'
import { PaperVault } from './lib/vault.js'
import { pageMeta } from './lib/webpage.js'

/** Cordis plugin name; also the id of the bundle row in cordis.patch.yml. */
export const name = 'paper-vault'

/** The tools registry is the only host service this bundle needs. */
export const inject = ['tools']

const MAX_PDF_BYTES = 40 * 1024 * 1024

/**
 * A small, local-first paper vault: the parts of Agentero that work without its desktop
 * CLI or React panels. Search arXiv, import by arXiv/DOI/URL, keep PDFs and Markdown
 * notes under `$DSH_HOME/data/paper-vault`, and cite what is actually on the phone.
 */
export function apply(ctx, config = {}) {
  const root = resolveRoot(config)
  const vault = new PaperVault(root)
  let initialized
  const ensure = () => {
    if (!initialized) {
      initialized = vault.init().catch((error) => {
        initialized = undefined
        throw error
      })
    }
    return initialized
  }

  const disposers = [
    ctx.tools.register({
      name: 'paper_search_arxiv',
      description: 'Search arXiv for candidate papers (title, authors, year, abstract and arXiv id). ' +
        'Use it when the user asks to find papers on a topic. Papers already in the local vault are omitted; ' +
        'import a chosen candidate with paper_import.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Topic words, a phrase, or an author name.' },
          limit: { type: 'integer', description: 'How many results, 1-10 (default 5).' },
        },
      },
      output: outputFor(),
      async execute(args) {
        await ensure()
        const query = str(args, 'query')
        if (!query) throw new Error('query is required')
        const limit = clamp(int(args, 'limit') ?? 5, 1, 10)
        const found = await searchArxiv(query, limit + 4)
        const catalog = await vault.load()
        const results = found
          .filter((paper) => !vault.lookup(catalog, paper.arxiv) && !vault.lookup(catalog, paper.title))
          .slice(0, limit)
          .map((paper) => ({ ...paper, abstract: truncate(paper.abstract, 700) }))
        return {
          query,
          results,
          hint: results.length
            ? 'Import one with paper_import and its arxivId.'
            : 'No new arXiv results (or they are already in the vault).',
        }
      },
    }),

    ctx.tools.register({
      name: 'paper_import',
      description: 'Import one paper into the local vault by arXiv id, DOI, or paper URL. ' +
        'Fetches metadata, downloads the PDF when the source exposes one, and de-duplicates by arXiv id/DOI/title. ' +
        'Returns the stored paper and its local PDF/note paths.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'arXiv id (2301.12345), DOI (10.1145/…), or an http(s) paper URL.' },
        },
      },
      output: outputFor(),
      async execute(args) {
        await ensure()
        const text = str(args, 'text')
        if (!text) throw new Error('text is required')
        const meta = await identify(text)
        const directPdf = meta.pdfBytes
        const clean = { ...meta }
        delete clean.pdfBytes
        let { paper, duplicate } = await vault.upsert(clean)
        let pdfError = ''
        if (!paper.pdf) {
          try {
            const bytes = directPdf ?? await downloadPdf(clean)
            if (bytes) paper = await vault.attachPdf(paper.id, bytes)
          } catch (error) {
            pdfError = error.message
          }
        }
        return {
          paper: publicPaper(paper),
          duplicate,
          vault: root,
          pdfPath: vault.pdfPath(paper) || null,
          notePath: vault.notePath(paper),
          ...(pdfError ? { pdfError } : {}),
          hint: duplicate
            ? 'Already in the vault; missing metadata was merged.'
            : 'Imported into the local vault.',
        }
      },
    }),

    ctx.tools.register({
      name: 'paper_list',
      description: 'List papers already in the local paper vault. Use this before searching the web when the user ' +
        'asks about "my papers", their library, reading list, a tag, or papers by an author. Returns compact rows.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Optional substring matched against title, authors, venue, tags, DOI and arXiv id.' },
          tag: { type: 'string', description: 'Only papers carrying this tag.' },
          unread: { type: 'boolean', description: 'Only unread papers when true.' },
          limit: { type: 'integer', description: 'How many rows, 1-50 (default 20).' },
        },
      },
      output: outputFor(),
      async execute(args) {
        await ensure()
        const result = await vault.list({
          query: str(args, 'query'),
          tag: str(args, 'tag'),
          unread: bool(args, 'unread') === true,
          limit: clamp(int(args, 'limit') ?? 20, 1, 50),
        })
        return { ...result, papers: result.papers.map(summary) }
      },
    }),

    ctx.tools.register({
      name: 'paper_show',
      description: 'Show one paper from the local vault with its abstract, tags, local PDF path and its Markdown note. ' +
        'Pass an id from paper_list, an arXiv id, a DOI, or a distinctive title fragment.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['ref'],
        properties: {
          ref: { type: 'string', description: 'Paper id, arXiv id, DOI, or title fragment.' },
        },
      },
      output: outputFor(),
      async execute(args) {
        await ensure()
        const ref = str(args, 'ref')
        if (!ref) throw new Error('ref is required')
        const paper = await vault.find(ref)
        if (!paper) throw new Error(`no paper matches ${JSON.stringify(ref)}`)
        const note = await vault.readNote(paper.id)
        return {
          paper: publicPaper(paper, true),
          vault: root,
          pdfPath: vault.pdfPath(paper) || null,
          notePath: vault.notePath(paper),
          note: truncate(note.text, 6000),
          noteChars: note.text.length,
        }
      },
    }),

    ctx.tools.register({
      name: 'paper_update',
      description: 'Organise a paper in the local vault: add/remove tags or mark it read/unread. ' +
        'The ref can be an id, arXiv id, DOI, or a distinctive title fragment.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['ref'],
        properties: {
          ref: { type: 'string', description: 'Paper id, arXiv id, DOI, or title fragment.' },
          addTags: { type: 'array', items: { type: 'string' }, description: 'Tags to add.' },
          removeTags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove.' },
          read: { type: 'boolean', description: 'Set the read flag.' },
        },
      },
      output: outputFor(),
      async execute(args) {
        await ensure()
        const ref = str(args, 'ref')
        if (!ref) throw new Error('ref is required')
        const paper = await vault.update(ref, {
          addTags: strings(args, 'addTags'),
          removeTags: strings(args, 'removeTags'),
          read: typeof args?.read === 'boolean' ? args.read : undefined,
        })
        return { paper: publicPaper(paper), hint: 'Paper updated.' }
      },
    }),

    ctx.tools.register({
      name: 'paper_note',
      description: 'Read or write the Markdown note beside one local paper. Omit text to read it; with text, append by ' +
        'default (set replace=true to overwrite). Notes live in the vault next to the PDF.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['ref'],
        properties: {
          ref: { type: 'string', description: 'Paper id, arXiv id, DOI, or title fragment.' },
          text: { type: 'string', description: 'Markdown to write; omit to read the note.' },
          append: { type: 'boolean', description: 'Append instead of replacing (default true when text is given).' },
          replace: { type: 'boolean', description: 'Overwrite the note with text.' },
        },
      },
      output: outputFor(),
      async execute(args) {
        await ensure()
        const ref = str(args, 'ref')
        if (!ref) throw new Error('ref is required')
        if (typeof args?.text !== 'string') {
          const note = await vault.readNote(ref)
          return {
            paper: summary(note.paper),
            note: note.text,
            path: note.path,
            notePath: vault.notePath(note.paper),
          }
        }
        const append = args?.replace === true ? false : args?.append !== false
        const note = await vault.writeNote(ref, args.text, { append })
        return {
          paper: summary(note.paper),
          path: note.path,
          notePath: vault.notePath(note.paper),
          chars: note.text.length,
          hint: append ? 'Note appended.' : 'Note written.',
        }
      },
    }),

    ctx.tools.register({
      name: 'paper_notes_search',
      description: 'Search the Markdown notes under the paper vault by title, paper id, or body text. ' +
        'Use it to answer questions from the user\'s own reading notes, with the note path as the citation.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Words or a phrase to find in the notes.' },
          limit: { type: 'integer', description: 'How many notes, 1-20 (default 20).' },
        },
      },
      output: outputFor(),
      async execute(args) {
        await ensure()
        const query = str(args, 'query')
        if (!query) throw new Error('query is required')
        return await vault.searchNotes(query, clamp(int(args, 'limit') ?? 20, 1, 20))
      },
    }),

    ctx.tools.register({
      name: 'paper_cite',
      description: 'Return BibTeX for papers in the local vault (by ids, a query, or all papers). ' +
        'Use the local records so the citation matches the PDF actually on the phone; never invent a DOI.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Paper ids (from paper_list).' },
          query: { type: 'string', description: 'Filter by title/authors/tags when ids are omitted.' },
          limit: { type: 'integer', description: 'At most this many entries, 1-50 (default 20).' },
        },
      },
      output: outputFor(),
      async execute(args) {
        await ensure()
        const limit = clamp(int(args, 'limit') ?? 20, 1, 50)
        let papers
        const ids = strings(args, 'ids')
        if (ids.length) {
          papers = []
          for (const id of ids.slice(0, limit)) {
            const paper = await vault.find(id)
            if (paper) papers.push(paper)
          }
        } else {
          papers = (await vault.list({ query: str(args, 'query'), limit })).papers
        }
        if (!papers.length) throw new Error('no papers matched')
        return {
          count: papers.length,
          papers: papers.map((paper) => ({ id: paper.id, title: paper.title, year: paper.year })),
          bibtex: bibtex(papers, limit),
        }
      },
    }),
  ]

  return () => {
    for (const dispose of disposers) dispose()
  }
}

function outputFor() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

function resolveRoot(config) {
  const explicit = typeof config?.vault === 'string' ? config.vault.trim() : ''
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  if (!explicit) return path.join(home, 'data', 'paper-vault')
  return path.isAbsolute(explicit) ? explicit : path.join(home, explicit)
}

/** Turn the user's pasted reference into one metadata record. */
async function identify(text) {
  const value = String(text ?? '').trim()
  if (!value) throw new Error('text is required')
  const arxiv = normalizeArxivId(value)
  if (arxiv) return { ...(await arxivById(arxiv)), arxiv }
  const doi = normalizeDoi(value) || (value.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/i)?.[0] ?? '')
  if (doi) {
    const arxivDoi = doi.match(/^10\.48550\/arxiv\.(.+)$/i)
    if (arxivDoi) {
      const id = normalizeArxivId(arxivDoi[1])
      if (id) return { ...(await arxivById(id)), arxiv: id }
    }
    return await crossrefByDoi(doi)
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new Error('not an arXiv id, DOI, or http(s) URL')
  }
  // A direct PDF link has no HTML metadata; read its Info dictionary and keep the bytes.
  if (/\.pdf(?:[?#]|$)/i.test(value)) return await pdfUrlMeta(value)
  const page = await pageMeta(value)
  if (page.arxiv) {
    try {
      return { ...(await arxivById(page.arxiv)), arxiv: page.arxiv, pdfUrl: page.pdfUrl || arxivPdfUrl(page.arxiv) }
    } catch {
      // The page still has usable metadata; fall through to it.
    }
  }
  if (page.doi) {
    try {
      const rich = await crossrefByDoi(page.doi)
      return { ...page, ...rich, pdfUrl: page.pdfUrl || rich.pdfUrl, url: page.url || rich.url }
    } catch {
      // Keep the page metadata.
    }
  }
  if (!page.title) throw new Error('no title found on that page')
  return page
}

/** Download the advertised PDF, or null when the record has no PDF URL. */
async function downloadPdf(meta) {
  const url = meta.pdfUrl || (meta.arxiv ? arxivPdfUrl(meta.arxiv) : '')
  if (!url) return null
  return await fetchBytes(url, {
    timeout: 120_000,
    maxBytes: MAX_PDF_BYTES,
    headers: { accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5' },
  })
}

/** Metadata for a URL that points straight at a PDF (common on university pages). */
async function pdfUrlMeta(url) {
  const bytes = await fetchBytes(url, {
    timeout: 120_000,
    maxBytes: MAX_PDF_BYTES,
    headers: { accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5' },
  })
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('that URL is not a PDF')
  const info = pdfInfo(bytes)
  let name = ''
  try {
    name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  } catch {
    name = ''
  }
  const fallback = name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  return {
    title: info.title || fallback || 'Untitled paper',
    authors: info.authors,
    year: '',
    venue: '',
    abstract: '',
    doi: '',
    arxiv: '',
    url,
    pdfUrl: url,
    pdfBytes: bytes,
  }
}

function publicPaper(paper, withAbstract = true) {
  return {
    ...summary(paper),
    abstract: withAbstract ? truncate(paper.abstract, 4000) : truncate(paper.abstract, 700),
    url: paper.url,
    addedAt: paper.addedAt,
    updatedAt: paper.updatedAt,
  }
}

function summary(paper) {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors ?? [],
    year: paper.year,
    venue: paper.venue,
    tags: paper.tags ?? [],
    read: paper.read === true,
    arxiv: paper.arxiv,
    doi: paper.doi,
    hasPdf: Boolean(paper.pdf),
  }
}

function str(args, key) {
  const value = args?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function int(args, key) {
  const value = args?.[key]
  return Number.isInteger(value) ? value : undefined
}

function bool(args, key) {
  return typeof args?.[key] === 'boolean' ? args[key] : undefined
}

function strings(args, key) {
  const value = args?.[key]
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
