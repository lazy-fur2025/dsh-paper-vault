import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEntries } from '../lib/arxiv.js'

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2301.12345v2</id>
    <updated>2023-02-01T00:00:00Z</updated>
    <published>2023-01-29T00:00:00Z</published>
    <title>Attention Is All You Need</title>
    <summary>We propose a new simple network architecture, the Transformer.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <arxiv:doi>10.48550/arXiv.2301.12345</arxiv:doi>
    <link title="doi" href="https://doi.org/10.48550/arXiv.2301.12345"/>
    <link title="pdf" href="http://arxiv.org/pdf/2301.12345v2"/>
  </entry>
</feed>`

test('parses one Atom entry into paper metadata', () => {
  const [paper] = parseEntries(FEED)
  assert.equal(paper.arxivId, '2301.12345')
  assert.equal(paper.title, 'Attention Is All You Need')
  assert.deepEqual(paper.authors, ['Ashish Vaswani', 'Noam Shazeer'])
  assert.equal(paper.year, '2023')
  assert.equal(paper.doi, '10.48550/arXiv.2301.12345')
  assert.equal(paper.pdfUrl, 'http://arxiv.org/pdf/2301.12345v2')
  assert.match(paper.abstract, /Transformer/)
})

test('an empty or login page feed yields no entries', () => {
  assert.deepEqual(parseEntries('<html><body>login</body></html>'), [])
})
