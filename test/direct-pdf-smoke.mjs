import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Title (Local PDF Test) /Author (Test Author) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
)
const server = createServer((req, res) => {
  if (req.url === '/paper.pdf') {
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(pdf.length) })
    res.end(pdf)
  } else {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const home = await mkdtemp(path.join(os.tmpdir(), 'paper-vault-pdf-'))
process.env.DSH_HOME = home
const tools = new Map()
const ctx = { tools: { register: (definition) => (tools.set(definition.name, definition), () => tools.delete(definition.name)) } }
const dispose = apply(ctx)
try {
  const result = await tools.get('paper_import').execute({ text: `http://127.0.0.1:${port}/paper.pdf` })
  assert.equal(result.paper.title, 'Local PDF Test')
  assert.deepEqual(result.paper.authors, ['Test Author'])
  assert.ok(result.pdfPath)
  assert.ok((await stat(result.pdfPath)).size > 20)
  console.log('direct PDF import OK:', result.paper.title, '->', result.pdfPath)
} finally {
  dispose()
  server.close()
  await rm(home, { recursive: true, force: true })
}
