import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PaperVault } from '../lib/vault.js'

async function withVault(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paper-vault-'))
  try {
    const vault = new PaperVault(root)
    await vault.init()
    await fn(vault, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const transformer = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  year: '2017',
  venue: 'arXiv',
  abstract: 'The Transformer.',
  doi: '',
  arxiv: '1706.03762',
  url: 'https://arxiv.org/abs/1706.03762',
}

test('imports once and merges a duplicate by arXiv id', async () => {
  await withVault(async (vault) => {
    const first = await vault.upsert(transformer)
    assert.equal(first.duplicate, false)
    assert.equal(first.paper.id, 'arxiv-1706.03762')
    const second = await vault.upsert({ ...transformer, abstract: 'ignored when already present' })
    assert.equal(second.duplicate, true)
    assert.equal(second.paper.id, first.paper.id)
    assert.equal(second.paper.abstract, 'The Transformer.')
    const listed = await vault.list()
    assert.equal(listed.total, 1)
  })
})

test('stores PDFs, tags, read state and notes; searches notes', async () => {
  await withVault(async (vault) => {
    const { paper } = await vault.upsert(transformer)
    await vault.attachPdf(paper.id, Buffer.from('%PDF-1.4\nfake'))
    const tagged = await vault.update(paper.id, { addTags: ['nlp', 'transformer'], read: true })
    assert.deepEqual(tagged.tags, ['nlp', 'transformer'])
    assert.equal(tagged.read, true)
    await vault.update(paper.id, { removeTags: ['nlp'] })
    assert.deepEqual((await vault.find(paper.id)).tags, ['transformer'])

    await vault.writeNote(paper.id, 'Key idea: self-attention replaces recurrence.')
    await vault.writeNote(paper.id, 'Follow-up: efficient attention.', { append: true })
    const note = await vault.readNote(paper.id)
    assert.match(note.text, /self-attention/)
    assert.match(note.text, /efficient attention/)
    assert.match(note.path, /^notes\/arxiv-1706\.03762\.md$/)

    const hits = await vault.searchNotes('efficient')
    assert.equal(hits.notes.length, 1)
    assert.equal(hits.notes[0].paperId, paper.id)
    assert.match(hits.notes[0].excerpt, /efficient attention/)
  })
})
