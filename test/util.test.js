import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeEntities,
  normalizeArxivId,
  normalizeDoi,
  normalizeTitle,
  pdfInfo,
  stripTags,
} from '../lib/util.js'

test('entities and tags become readable text', () => {
  assert.equal(decodeEntities('A &amp; B &#8212; C'), 'A & B — C')
  assert.equal(stripTags('<jats:p>Hello <b>world</b>&nbsp;!</jats:p>'), 'Hello world !')
})

test('arXiv ids accept the forms people paste', () => {
  assert.equal(normalizeArxivId('2301.12345'), '2301.12345')
  assert.equal(normalizeArxivId('arXiv:2301.12345v3'), '2301.12345')
  assert.equal(normalizeArxivId('https://arxiv.org/abs/2301.12345'), '2301.12345')
  assert.equal(normalizeArxivId('https://arxiv.org/pdf/2301.12345.pdf'), '2301.12345')
  assert.equal(normalizeArxivId('hep-th/9901001'), 'hep-th/9901001')
  assert.equal(normalizeArxivId('not a paper'), '')
})

test('DOIs lose the resolver prefix and trailing punctuation', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1145/3290605.3300234'), '10.1145/3290605.3300234')
  assert.equal(normalizeDoi('doi: 10.1000/XYZ.1.'), '10.1000/xyz.1')
})

test('a URL or plain text is not mistaken for a DOI', () => {
  assert.equal(normalizeDoi('https://example.com/paper.pdf'), '')
  assert.equal(normalizeDoi('not a doi'), '')
})

test('title matching ignores case and punctuation', () => {
  assert.equal(normalizeTitle('Attention Is All You Need!'), 'attention is all you need')
  assert.equal(normalizeTitle('Attention   is all you need'), 'attention is all you need')
})

test('PDF Info gives a title and author when present', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (A Paper About \\(Things\\)) /Author (Jane Doe) >>\nendobj\n')
  assert.deepEqual(pdfInfo(pdf), { title: 'A Paper About (Things)', authors: ['Jane Doe'] })
})
