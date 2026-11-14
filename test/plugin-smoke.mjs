import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply, name } from '../index.js'

const home = await mkdtemp(path.join(os.tmpdir(), 'paper-vault-live-'))
process.env.DSH_HOME = home
const tools = new Map()
const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  },
}
const dispose = apply(ctx)
assert.equal(name, 'paper-vault')
assert.equal(tools.size, 8)

const imported = await tools.get('paper_import').execute({ text: '1706.03762' })
console.log('import', imported.paper.id, imported.duplicate, Boolean(imported.pdfPath))
assert.equal(imported.paper.id, 'arxiv-1706.03762')
assert.ok(imported.pdfPath)
const pdf = await stat(imported.pdfPath)
assert.ok(pdf.size > 100_000)

const again = await tools.get('paper_import').execute({ text: 'https://arxiv.org/abs/1706.03762' })
assert.equal(again.duplicate, true)

const list = await tools.get('paper_list').execute({})
console.log('list', list.total, list.papers[0].title)
assert.equal(list.total, 1)

const note = await tools.get('paper_note').execute({ ref: '1706.03762', text: 'Self-attention only.' })
assert.match(note.notePath, /arxiv-1706\.03762\.md$/)
const read = await tools.get('paper_note').execute({ ref: 'arxiv-1706.03762' })
assert.match(read.note, /Self-attention/)

const cite = await tools.get('paper_cite').execute({ ids: ['1706.03762'] })
assert.match(cite.bibtex, /@misc\{vaswani2017attention,/)
console.log('bibtex', cite.bibtex.split('\n')[0])

const catalog = JSON.parse(await readFile(path.join(home, 'data', 'paper-vault', 'catalog.json'), 'utf8'))
assert.equal(catalog.papers.length, 1)
assert.ok(catalog.papers[0].pdf.startsWith('pdfs/'))
dispose()
await rm(home, { recursive: true, force: true })
console.log('live plugin smoke OK')
