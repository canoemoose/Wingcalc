// The servo catalogue's published specs (Hitec and Futaba), the Futaba entries without drawings,
// and the arms and horns in linkage.js.
import { describe, it, expect } from 'vitest'
import { SERVOS, SERVO_CLASSES, HITEC, FUTABA, CATALOGUE, servoById, servoFrame, installedServo, ratedTorque } from '../src/lib/servos.js'
import { HITEC_SPECS, FUTABA_FIGURES } from '../src/lib/servoCatalogue.js'
import { ARMS, HORNS, armsFor } from '../src/lib/linkage.js'

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

  it('says its lugs, output and lead are estimated, and builds them from the class', () => {
    for (const s of FUTABA) {
      expect(s.estimated).toEqual(['lugs', 'output', 'lead'])
      expect(s.lugSpan).toBeUndefined()
      const f = servoFrame(s)
      const cls = SERVOS[s.class]
      // The lug span scales with the case's length, so lugs always stand beyond it
      expect(f.lugSpan).toBeCloseTo((s.body[0] * cls.lugSpan) / cls.length, 9)
      expect(f.lugSpan).toBeGreaterThan(s.body[0])
      expect(f.lugHeight).toBeLessThan(s.body[2])
      expect(f.output.top).toBeGreaterThan(s.body[2])
    }
    // Hitec's are drawn
    for (const s of HITEC) expect(s.estimated).toBeUndefined()
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
