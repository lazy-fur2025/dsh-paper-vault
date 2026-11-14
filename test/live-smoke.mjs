import { arxivById, searchArxiv } from '../lib/arxiv.js'
import { crossrefByDoi } from '../lib/crossref.js'
import { pageMeta } from '../lib/webpage.js'

const results = await searchArxiv('transformer attention', 3)
console.log('search', results.length, results[0]?.title, results[0]?.arxivId)
const paper = await arxivById('1706.03762')
console.log('arxiv', paper.title, paper.authors.length, paper.pdfUrl)
const cross = await crossrefByDoi('10.1145/3290605.3300234')
console.log('crossref', cross.title, cross.authors[0], cross.year, cross.venue)
const page = await pageMeta('https://arxiv.org/abs/1706.03762')
console.log('page', page.title, page.arxiv, page.pdfUrl)
