// Arithmetic in numeric entry boxes: + - * / (also × ÷), brackets, and an optional unit on
// any number, converted to the box's unit ("12in" in a millimetre box is 304.8; "300mm + 2in"
// works too). A percent-of-chord box given its chord also takes a length ("12mm" of a 240 mm
// chord is 5 %). Commas are thousands separators, as usual in the UK. A small recursive-descent
// parser, so nothing is ever passed to eval.

import { UNITS } from './units.js'

// Unit spellings accepted after a number, per quantity, as factors to the SI base unit.
const LENGTH = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, '"': 0.0254, inch: 0.0254, inches: 0.0254, ft: 0.3048, "'": 0.3048, feet: 0.3048 }
const ALIASES = {
  length: LENGTH,
  thin: LENGTH,
  mass: { g: 0.001, kg: 1, oz: 0.028349523125, lb: 0.45359237, lbs: 0.45359237 },
  area: {
    mm2: 1e-6,
    cm2: 1e-4,
    dm2: 0.01,
    m2: 1,
    in2: 0.00064516,
    ft2: 0.09290304,
    sqin: 0.00064516,
    sqft: 0.09290304,
  },
  percent: { '%': 0.01, pct: 0.01 },
}

function tokenise(text) {
  const tokens = []
  const src = text.replace(/,/g, '').replace(/²/g, '2').replace(/×/g, '*').replace(/÷/g, '/').trim()
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
    } else if (/[0-9.]/.test(ch)) {
      const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i)
      if (!m) return null
      tokens.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
    } else if ('+-*/()'.includes(ch)) {
      tokens.push({ t: ch })
      i++
    } else {
      const m = src.slice(i).match(/^([a-z]+2?|"|'|%)/i)
      if (!m) return null
      tokens.push({ t: 'unit', v: m[0].toLowerCase() })
      i += m[0].length
    }
  }
  return tokens
}

// Evaluate text to a number in the box's own unit, or null if it isn't a complete,
// valid expression. quantity/unit are optional (plain numbers only without them). chord (m)
// lets a percent box take lengths, as a share of that chord.
export function evaluate(text, { quantity = null, unit = null, chord = null } = {}) {
  if (typeof text !== 'string' || !text.trim()) return null
  const tokens = tokenise(text)
  if (!tokens?.length) return null
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function primary() {
    const tok = next()
    if (!tok) throw new Error('end')
    if (tok.t === 'num') {
      let v = tok.v
      if (peek()?.t === 'unit') {
        const u = next().v
        let factor = quantity ? ALIASES[quantity]?.[u] : undefined
        if (factor === undefined && quantity === 'percent' && chord > 0 && LENGTH[u]) factor = LENGTH[u] / chord
        const own = quantity && unit ? UNITS[quantity]?.[unit]?.factor : undefined
        if (factor === undefined || own === undefined) throw new Error('unit')
        v = (v * factor) / own
      }
      return v
    }
    if (tok.t === '(') {
      const v = sum()
      if (next()?.t !== ')') throw new Error('bracket')
      return v
    }
    throw new Error('token')
  }
  function unary() {
    if (peek()?.t === '-') {
      next()
      return -unary()
    }
    if (peek()?.t === '+') {
      next()
      return unary()
    }
    return primary()
  }
  function product() {
    let v = unary()
    while (peek()?.t === '*' || peek()?.t === '/') {
      const op = next().t
      const r = unary()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  function sum() {
    let v = product()
    while (peek()?.t === '+' || peek()?.t === '-') {
      const op = next().t
      const r = product()
      v = op === '+' ? v + r : v - r
    }
    return v
  }

  try {
    const v = sum()
    if (pos !== tokens.length) return null
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

// True when the text has a length in it ("12mm", '0.5"'), which a percent box takes as a share
// of its chord
export const hasLength = (text) => (tokenise(text ?? '') ?? []).some((t) => t.t === 'unit' && LENGTH[t.v])

// True when the text is more than a plain number, so the box can show what it works out to.
export function isExpression(text) {
  return typeof text === 'string' && !/^\s*[+-]?(\d[\d,]*\.?\d*|\.\d+)\s*$/.test(text) && text.trim() !== ''
}
