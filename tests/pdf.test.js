import { describe, it, expect } from 'vitest'
import { unzlibSync, strFromU8 } from 'fflate'
import { drawingPdf, tiling } from '../src/lib/pdf.js'

const latin1 = (u8) => strFromU8(u8, true)

// A drawing with a 100 mm line along x, inside a w × h frame
const drawing = (w, h) => [
  {
    type: 'poly',
    layer: 'cut',
    pts: [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    closed: true,
  },
  {
    type: 'poly',
    layer: 'etch',
    pts: [
      [10, 10],
      [110, 10],
    ],
    closed: false,
  },
]

describe('PDF tiling', () => {
  it('turns the paper whichever way needs fewer sheets', () => {
    const t = tiling(400, 100, 'a4')
    expect([t.pw, t.ph]).toEqual([297, 210]) // landscape
    expect([t.cols, t.rows]).toEqual([2, 1])
    const tall = tiling(100, 400, 'a4')
    expect([tall.pw, tall.ph]).toEqual([210, 297])
  })

  it('fits the whole drawing on one sheet when asked', () => {
    const t = tiling(700, 300, 'fit')
    expect([t.cols, t.rows]).toEqual([1, 1])
    expect(t.pw).toBeGreaterThanOrEqual(700)
    expect(t.ph).toBeGreaterThan(300)
  })
})

describe('PDF file', () => {
  it('is well formed: header, every cross-reference landing on its object, page count, end', () => {
    const pdf = latin1(drawingPdf(drawing(400, 100), { paper: 'a4', project: 'Test', drawing: 'Parts', compress: false }))
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
    const xrefAt = Number(pdf.match(/startxref\n(\d+)/)[1])
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const entries = pdf.slice(xrefAt).split('\n').slice(3).filter((l) => / n $/.test(l))
    entries.forEach((line, i) => {
      const off = Number(line.slice(0, 10))
      expect(pdf.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`)
    })
    expect(pdf).toContain('/Count 2')
    expect((pdf.match(/\/Type \/Page /g) ?? []).length).toBe(2)
    // A4 landscape in points
    expect(pdf).toContain('/MediaBox [0 0 841.89 595.276]')
  })

  it('draws at true size: a 100 mm line is 283.46 points long', () => {
    const pdf = latin1(drawingPdf(drawing(150, 60), { paper: 'a4', compress: false }))
    // The etched line is drawn blue, from (10, 10) to (110, 10) in drawing millimetres
    const m = pdf.match(/0\.1 0\.3 0\.75 RG[\s\S]*?\n([\d.]+) ([\d.]+) m\n([\d.]+) ([\d.]+) l\nS/)
    expect(m).not.toBe(null)
    expect(Number(m[3]) - Number(m[1])).toBeCloseTo((100 * 72) / 25.4, 2)
    expect(Number(m[4])).toBeCloseTo(Number(m[2]), 6)
  })

  it('compresses the pages to the same content, and escapes text', () => {
    const plain = latin1(drawingPdf(drawing(150, 60), { project: 'Wing (test) \\ 2.5° × 3', compress: false, date: new Date('2026-10-12') }))
    const packed = drawingPdf(drawing(150, 60), { project: 'Wing (test) \\ 2.5° × 3', compress: true, date: new Date('2026-10-12') })
    const s = latin1(packed)
    const at = s.indexOf('/FlateDecode >>\nstream\n') + '/FlateDecode >>\nstream\n'.length
    const len = Number(s.slice(0, at).match(/\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n$/)[1])
    const content = latin1(unzlibSync(packed.slice(at, at + len)))
    expect(plain).toContain(content)
    expect(content).toContain('(Wing \\(test\\) \\\\ 2.5° × 3) Tj')
    expect(content).toContain('Scale 1:1')
    expect(content).toContain('50 mm')
  })
})
