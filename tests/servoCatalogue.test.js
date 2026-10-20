// The servo catalogue's published specs (Hitec and Futaba), the Futaba entries without drawings,
// and the arms and horns in linkage.js.
import { describe, it, expect } from 'vitest'
import { SERVOS, SERVO_CLASSES, HITEC, FUTABA, CATALOGUE, servoById, servoFrame, installedServo, ratedTorque } from '../src/lib/servos.js'
import { HITEC_SPECS, FUTABA_FIGURES } from '../src/lib/servoCatalogue.js'
import { ARMS, HORNS, armsFor } from '../src/lib/linkage.js'
import { servoSide } from '../src/lib/pieceDrawing.js'

const KG_CM = 0.0980665
const by = (m) => CATALOGUE.find((s) => s.model === m)

describe('published specs', () => {
  it('gives every Hitec servo its specs, and no spec names a servo that isn\'t listed', () => {
    expect(Object.keys(HITEC_SPECS).sort()).toEqual(HITEC.map((s) => s.model).sort())
  })

  it('rates every servo at one voltage at least, in N·m and seconds per 60°', () => {
    for (const s of CATALOGUE) {
      expect(s.ratings.length, s.model).toBeGreaterThan(0)
      for (const r of s.ratings) {
        expect(r.volts, s.model).toBeGreaterThanOrEqual(3.5)
        expect(r.volts, s.model).toBeLessThanOrEqual(8.4)
        // kgf·cm read as N·m would be about ten times too large
        if (r.torque != null) expect(r.torque, s.model).toBeGreaterThan(0.05)
        if (r.torque != null) expect(r.torque, s.model).toBeLessThan(7)
        if (r.speed != null) expect(r.speed, s.model).toBeGreaterThan(0.03)
        if (r.speed != null) expect(r.speed, s.model).toBeLessThan(0.6)
      }
      // More volts, more torque and more speed
      const rs = s.ratings.filter((r) => r.torque != null && r.speed != null)
      for (let i = 1; i < rs.length; i++) {
        expect(rs[i].volts, s.model).toBeGreaterThan(rs[i - 1].volts)
        expect(rs[i].torque, s.model).toBeGreaterThanOrEqual(rs[i - 1].torque)
        expect(rs[i].speed, s.model).toBeLessThanOrEqual(rs[i - 1].speed)
      }
    }
  })

  it('holds the figures as published', () => {
    const hs645 = by('HS-645MG')
    expect(hs645.ratings).toEqual([
      { volts: 4.8, torque: 7.7 * KG_CM, speed: 0.24 },
      { volts: 6.0, torque: 9.6 * KG_CM, speed: 0.2 },
    ])
    expect(hs645.spline).toEqual({ type: 'Standard 24', teeth: 24 })
    expect(by('HS-5125MG').spline).toEqual({ type: 'Micro 25', teeth: 25 })
    expect(by('D141SW').spline).toEqual({ type: 'H25T', teeth: 25 })
    const su300 = by('S-U300')
    expect(su300.body).toEqual([0.0404, 0.0198, 0.036])
    expect(su300.mass).toBe(0.036)
    expect(su300.ratings[1]).toEqual({ volts: 6.0, torque: 4.1 * KG_CM, speed: 0.19 })
    // Futaba names its splines by size, with no tooth count
    expect(su300.spline).toEqual({ type: 'Φ6', teeth: null })
  })

  it('uses only the known gear, digital and current values', () => {
    for (const s of CATALOGUE) {
      expect([null, 'plastic', 'karbonite', 'metal', 'titanium'], s.model).toContain(s.gears)
      expect([null, true, false], s.model).toContain(s.digital)
      expect([true, false], s.model).toContain(s.current)
    }
    expect(by('S3001').current).toBe(false)
  })

  it('lists a servo by its rating nearest 6 V', () => {
    expect(ratedTorque([{ volts: 4.8, torque: 1 }, { volts: 6, torque: 2 }])).toBe(2)
    expect(ratedTorque([{ volts: 6.6, torque: 3 }, { volts: 7.4, torque: 4 }])).toBe(3)
    expect(ratedTorque([{ volts: 4.8, torque: 1 }, { volts: 7.2, torque: 4 }])).toBe(4)
    expect(ratedTorque([{ volts: 4.8, torque: null }])).toBeNull()
    for (const s of FUTABA) expect(s.torque, s.model).toBe(ratedTorque(s.ratings))
  })
})

describe('Futaba catalogue', () => {
  it('has unique ids across both makers, following <maker>-<model>', () => {
    const ids = CATALOGUE.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of FUTABA) expect(s.id).toBe(`futaba-${s.model.toLowerCase()}`)
    expect(FUTABA).toHaveLength(FUTABA_FIGURES.length)
  })

  it('includes the S3001 and leaves out the retract and quarter-scale servos', () => {
    const models = FUTABA.map((s) => s.model)
    expect(models).toContain('S3001')
    for (const m of ['S3170G', 'S3306', 'S3306MG', 'S148', 'S9177SV']) expect(models).not.toContain(m)
  })

  it('sizes every entry as a class whose case it resembles', () => {
    for (const s of FUTABA) {
      expect(SERVO_CLASSES).toContain(s.class)
      expect(s.plate).toBe(SERVOS[s.class].plate)
      const [l, w, h] = s.body
      expect(l, s.model).toBeGreaterThan(0.015)
      expect(l, s.model).toBeLessThan(0.045)
      expect(w, s.model).toBeLessThanOrEqual(l)
      expect(h, s.model).toBeGreaterThan(0.015)
      expect(s.mass, s.model).toBeGreaterThan(0.005)
      expect(s.mass, s.model).toBeLessThan(0.1)
      // A slim wing servo is no more than 11 mm thick
      if (s.thin) expect(w, s.model).toBeLessThanOrEqual(0.011)
    }
  })

  it('carries the figures from its futaba.uk drawing, where it has one', () => {
    const drawn = FUTABA.filter((s) => s.lugSpan != null)
    expect(drawn.map((s) => s.model).sort()).toEqual(
      ['HPS-A703', 'HPS-A704', 'HPS-AA702', 'S-A300', 'S-A301', 'S-A400', 'S-A401', 'S-A501', 'S-A601', 'S-AG500', 'S-U300', 'S-U301', 'S-U305', 'S-U306', 'S-U400', 'S3114', 'S3150', 'S3154', 'S3155'].sort(),
    )
    for (const s of drawn) {
      const [l, , h] = s.body
      expect(s.lugSpan, s.model).toBeGreaterThan(l)
      expect(s.lugThickness, s.model).toBeGreaterThan(0.0005)
      expect(s.lugThickness, s.model).toBeLessThan(0.003)
      expect(s.lugHeight + s.lugThickness, s.model).toBeLessThanOrEqual(h + 1e-9)
      expect(s.caseHeight, s.model).toBeGreaterThan(s.lugHeight)
      expect(s.output.offset, s.model).toBeGreaterThan(0)
      expect(s.output.offset, s.model).toBeLessThan(l / 2)
      expect(s.output.top, s.model).toBeGreaterThan(h)
      expect(s.output.diameter, s.model).toBeGreaterThan(0.003)
      // Only the lead is ever left out of a drawing
      expect(s.estimated ?? [], s.model).toEqual(s.lead ? [] : ['lead'])
    }
    const su300 = by('S-U300')
    expect(su300.lugSpan).toBe(0.0555)
    expect(su300.lugHeight).toBe(0.0266)
    expect(su300.output).toEqual({ offset: 0.0099, top: 0.0421, diameter: 0.013 })
    // Four models share one case
    for (const m of ['S-U305', 'S-U306', 'S-A300', 'S-A301']) expect(by(m).lugSpan).toBe(by('S-U400').lugSpan)
    // A model drawn from its case-mate's drawing names it
    expect(by('S3155').drawing).toBe('S3150')
    expect(by('S3155').output).toEqual(by('S3150').output)
    expect(by('S3114').drawing).toBe('S3154')
    expect(by('S-U306').drawing).toBe('S-U400')
    expect(by('S3150').drawing).toBeUndefined()
    // The S-AG500 is a wing servo: lugs standing in its middle plane, a tab below
    const ag = by('S-AG500')
    expect(ag.wingLugs).toEqual({ length: 0.008, bottom: 'tab', tab: [0.01, 0.0064] })
    expect(ag.lugHeight + ag.wingLugs.length).toBeCloseTo(ag.body[2], 9)
    // S3154's gear tower stands above its 19.8 mm case
    expect(by('S3154').caseHeight).toBe(0.0198)
    expect(by('S3154').body[2]).toBe(0.0233)
  })

  it('takes the rest from the class where futaba.uk has no drawing, and says so', () => {
    const undrawn = FUTABA.filter((s) => s.lugSpan == null)
    expect(undrawn.length).toBeGreaterThan(0)
    for (const s of undrawn) {
      expect(s.estimated).toEqual(['lugs', 'output', 'lead'])
      const f = servoFrame(s)
      const cls = SERVOS[s.class]
      // The lug span scales with the case's length, so lugs always stand beyond it
      expect(f.lugSpan).toBeCloseTo((s.body[0] * cls.lugSpan) / cls.length, 9)
      expect(f.lugSpan).toBeGreaterThan(s.body[0])
      expect(f.lugHeight).toBeLessThan(s.body[2])
      expect(f.output.top).toBeGreaterThan(s.body[2])
    }
    // A drawn model missing only its lead gets the class's lead and keeps its own lugs
    const a400 = servoFrame(by('S-A400'))
    expect(by('S-A400').estimated).toEqual(['lead'])
    expect(a400.lugSpan).toBe(0.0545)
    expect(a400.lead.exit).toBe('end')
    // Hitec's are all drawn
    for (const s of HITEC) expect(s.estimated).toBeUndefined()
  })

  it('installs every servo every way up, and the side view says where its figures come from', () => {
    for (const s of FUTABA) {
      for (const m of ['upright', 'side', 'flat']) {
        const v = installedServo(s.id, m)
        expect(v.height, `${s.model} ${m}`).toBeGreaterThan(0)
        expect(v.run, `${s.model} ${m}`).toBeGreaterThan(0)
      }
    }
    expect(servoSide(installedServo('futaba-s-u300')).caption).toMatch(/^Side view, from Futaba's drawing:/)
    expect(servoSide(installedServo('futaba-s-a400')).caption).toMatch(/the lead, which it doesn't show/)
    expect(servoSide(installedServo('futaba-s3102')).caption).toMatch(/no drawing published/)
    expect(servoSide(installedServo('futaba-s3155')).caption).toMatch(/^Side view, from Futaba's drawing of the S3150, which shares its case:/)
  })

  it('installs in a bay like any catalogue servo', () => {
    const v = installedServo('futaba-s-u300', 'upright')
    expect(v.label).toBe('S-U300')
    expect(v.maker).toBe('Futaba')
    expect(v.length).toBeCloseTo(0.0404, 9)
    expect(v.height).toBeGreaterThan(0.036)
    expect(servoById('futaba-s3150').thin).toBe(true)
    // Laid flat, a slim servo needs little depth
    expect(installedServo('futaba-s3150', 'flat').height).toBeLessThan(0.015)
  })
})

describe('arms', () => {
  it('has unique ids, known kinds, and no hole positions until measured', () => {
    const ids = ARMS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ARMS) {
      expect(['Hitec', 'Futaba']).toContain(a.maker)
      expect(['single', 'double', 'cross', 'star', 'tee', 'disc', 'set']).toContain(a.kind)
      expect(a.holes).toBeNull()
      expect(a.source).toMatch(/^https:\/\//)
      // An arm with neither a spline nor named servos can't be offered for anything
      if (!a.spline) expect(Array.isArray(a.models)).toBe(true)
    }
  })

  it('offers a servo its own maker\'s arms on its spline, or made for it by name', () => {
    for (const s of CATALOGUE) {
      for (const a of armsFor(s)) {
        expect(a.maker).toBe(s.maker)
        expect(a.spline === s.spline?.type || a.models.includes(s.model), `${s.model} ${a.part}`).toBe(true)
      }
    }
    const parts = (m) => armsFor(by(m)).map((a) => a.part)
    expect(parts('HS-645MG')).toEqual(['55702', '55709', '55701'])
    expect(parts('HS-5125MG')).toEqual(expect.arrayContaining(['55706', '55707', '55718']))
    expect(parts('S-U300')).toContain('FSH-6X')
    // S3107 by name, though Futaba publishes no spline for it
    expect(parts('S3107')).toEqual(['FSH-63'])
    // Futaba's arms never go on a Hitec servo, nor anything on a generic class
    expect(armsFor(by('HS-645MG')).some((a) => a.maker === 'Futaba')).toBe(false)
    expect(armsFor(servoById('micro'))).toEqual([])
  })

  it('only names splines that some servo has, or none', () => {
    const types = new Set(CATALOGUE.map((s) => s.spline?.type).filter(Boolean))
    for (const a of ARMS) if (a.spline) expect(types.has(a.spline), a.part).toBe(true)
  })
})

describe('horns', () => {
  it('lists each horn once, sized, with heights in metres and no hole positions until measured', () => {
    const ids = HORNS.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const h of HORNS) {
      expect(['micro', 'mini', 'standard', 'large']).toContain(h.size)
      if (h.height != null) expect(h.height).toBeLessThan(0.05)
      expect(h.holes).toBeNull()
    }
  })
})
