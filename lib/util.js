import { createHash } from 'node:crypto'

/** One UA for arXiv/Crossref/publisher pages; honest and easy to spot in their logs. */
export const USER_AGENT = 'dsh-paper-vault/0.1 (+https://github.com/deepseek-ai/deepseek-harness)'

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·',
}

/** Decode the XML/HTML entities that appear in titles and abstracts. */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&([a-z][a-z0-9]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
}

function safeCodePoint(value) {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : ''
  } catch {
    return ''
  }
}

/** Visible text of an HTML/XML fragment: scripts and tags removed, whitespace collapsed. */
export function stripTags(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  ).replace(/\s+/g, ' ').trim()
}

/** `10.1145/…`, `https://doi.org/…` and `doi:…` all become the bare lowercase DOI. */
export function normalizeDoi(text) {
  const clean = String(text ?? '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;)\]]+$/, '')
    .toLowerCase()
  return /^10\.\d{4,9}\/\S+$/.test(clean) ? clean : ''
}

/**
 * `2301.12345v2`, `arXiv:2301.12345`, `https://arxiv.org/abs/2301.12345` and
 * `https://arxiv.org/pdf/2301.12345.pdf` all become `2301.12345` (version dropped).
 * Old-style `hep-th/9901001` ids are accepted too.
 */
export function normalizeArxivId(text) {
  let s = String(text ?? '').trim()
  const inUrl = s.match(/arxiv\.org\/(?:abs|pdf)\/([^?#\s]+)/i)
  if (inUrl) s = inUrl[1]
  s = s.replace(/^arxiv:\s*/i, '').replace(/\.pdf$/i, '').replace(/v\d+$/i, '')
  const m = s.match(/^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})$/i)
  return m ? m[1] : ''
}

/** ASCII-only file/id segment; Chinese titles fall back to `paper` plus a hash. */
export function slug(text, max = 48) {
  const s = stripTags(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
  return s || 'paper'
}

export function shortHash(text, length = 8) {
  return createHash('sha1').update(String(text)).digest('hex').slice(0, length)
}

/** Case/punctuation-insensitive title key used for de-duplication. */
export function normalizeTitle(text) {
  return stripTags(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function truncate(text, max) {
  const s = String(text ?? '')
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function isHttpUrl(text) {
  try {
    const url = new URL(String(text))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Host for user-facing errors, never the full query string. */
export function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return String(url)
  }
}

/** Read at most `maxBytes`; rejects a declared or streamed response over the cap. */
async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error(`response is ${declared} bytes (limit ${maxBytes})`)
  if (!response.body) return Buffer.alloc(0)
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.byteLength
    if (total > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`)
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function fetchBytes(url, options = {}) {
  const {
    timeout = 30_000,
    maxBytes = 4_000_000,
    headers = {},
  } = options
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'en, zh;q=0.8',
      ...headers,
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${hostOf(url)}`)
  return readCapped(response, maxBytes)
}

export async function fetchText(url, options = {}) {
  const bytes = await fetchBytes(url, options)
  return bytes.toString('utf8')
}

/** Extract meta tags (name/property/itemprop) into a lowercase name → values map. */
export function metaTags(html) {
  const out = new Map()
  for (const match of String(html ?? '').matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    const name = attr(tag, 'name') || attr(tag, 'property') || attr(tag, 'itemprop')
    const content = attr(tag, 'content')
    if (!name || !content) continue
    const key = name.trim().toLowerCase()
    const list = out.get(key) ?? []
    list.push(decodeEntities(content).replace(/\s+/g, ' ').trim())
    out.set(key, list)
  }
  return out
}

/** `<link rel="..." type="..." href="...">` hrefs matching rel (and type, when given). */
export function linkHrefs(html, rel, type = '') {
  const out = []
  for (const match of String(html ?? '').matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0]
    const tagRel = attr(tag, 'rel').toLowerCase()
    const tagType = attr(tag, 'type').toLowerCase()
    if (tagRel.split(/\s+/).includes(rel) && (!type || tagType === type)) {
      const href = attr(tag, 'href')
      if (href) out.push(decodeEntities(href))
    }
  }
  return out
}

/** One attribute of one tag; supports double, single and unquoted values. */
export function attr(tag, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = String(tag).match(re)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : ''
}

/** Make a relative href absolute against the page URL; null when the result is not http(s). */
export function absoluteUrl(base, href) {
  try {
    const url = new URL(href, base)
    return isHttpUrl(url.href) ? url.href : null
  } catch {
    return null
  }
}

/**
 * Best-effort title/author from a PDF's Info dictionary, without parsing the whole document.
 * Falls back to empty strings when the producer wrote compressed/UTF-16 strings.
 */
export function pdfInfo(bytes) {
  const head = Buffer.from(bytes).subarray(0, Math.min(bytes.length, 512 * 1024)).toString('latin1')
  const title = pdfString(head, 'Title')
  const author = pdfString(head, 'Author')
  return { title, authors: author ? [author] : [] }
}

function pdfString(head, key) {
  const m = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^)])*)\\)`).exec(head)
  if (!m) return ''
  return m[1]
    .replace(/\\([nrtbf()\\])/g, (_, ch) => ({ n: '\n', r: '', t: ' ', b: '', f: '', '(': '(', ')': ')', '\\': '\\' })[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim()
}
