import assert from 'node:assert/strict'
import test from 'node:test'
import { bibtex } from '../lib/bibtex.js'

const papers = [
  {
    id: 'arxiv-2301.12345', title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: '2017', venue: 'arXiv', arxiv: '2301.12345', doi: '', url: 'https://arxiv.org/abs/2301.12345',
  },
  {
    id: 'doi-a', title: 'A Study of Things', authors: ['Smith, Jane'], year: '2020',
    venue: 'Journal of Tests', doi: '10.1000/test', arxiv: '', url: 'https://doi.org/10.1000/test',
  },
  {
    id: 'doi-b', title: 'A Study of Things', authors: ['Smith, Jane'], year: '2020',
    venue: 'Another Journal', doi: '10.1000/other', arxiv: '', url: '',
  },
]

test('renders arXiv and journal entries with stable keys', () => {
  const text = bibtex(papers)
  assert.match(text, /@misc\{vaswani2017attention,/)
  assert.match(text, /eprint = \{2301\.12345\}/)
  assert.match(text, /@article\{smith2020study,/)
  assert.match(text, /author = \{Smith, Jane\}/)
  assert.match(text, /journal = \{Journal of Tests\}/)
})

test('duplicate keys get a suffix instead of colliding', () => {
  const text = bibtex(papers)
  assert.match(text, /@article\{smith2020studyb,/)
})
