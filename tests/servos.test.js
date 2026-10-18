// The Hitec catalogue and its lookups: ids, mounting envelopes, the picker's options, the
// size class a model's mass suggests, and the saved bay settings. Bay placement itself is
// covered in servoBays.test.js.
import { describe, it, expect } from 'vitest'
import {
  SERVOS, SERVO_CLASSES, HITEC, MOUNTINGS,
  servoEnvelope, servoById, servoOptions, defaultServoClass, bayOf, setBay, dropBay, installedServo,
  servoFrame, servoParts,
} from '../src/lib/servos.js'

describe('Hitec catalogue', () => {
  it('has unique ids that follow hitec-<model>', () => {
    const ids = HITEC.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of HITEC) expect(s.id).toBe(`hitec-${s.model.toLowerCase()}`)
  })

  it('sizes every entry as a generic class that exists', () => {
    for (const s of HITEC) {
      expect(SERVO_CLASSES).toContain(s.class)
      expect(s.plate).toBe(SERVOS[s.class].plate)
      expect(s.leadHole).toBe(SERVOS[s.class].leadHole)
    }
  })

  it('has positive dimensions, mass and torque in SI units', () => {
    for (const s of HITEC) {
      for (const d of s.body) expect(d).toBeGreaterThan(0)
      expect(s.mass).toBeGreaterThan(0)
      // Torque is N·m. A servo rated in kg·cm read as N·m would be about 10x too large, so
      // this range catches a units slip without asserting the unverified figures themselves.
      expect(s.torque).toBeGreaterThan(0.05)
      expect(s.torque).toBeLessThan(2)
    }
  })

  it('has lug spans no shorter than the body', () => {
    for (const s of HITEC) expect(s.lugSpan).toBeGreaterThanOrEqual(s.body[0])
  })

  it('drops the discontinued models', () => {
    const models = HITEC.map((s) => s.model)
    expect(models).not.toContain('HS-422')
  })
  it('lists the wing and sport servos Phoenix Model Products sells', () => {
    const models = HITEC.map((s) => s.model)
    for (const m of ['HS-55', 'HS-65HB', 'HS-5055MG', 'HS-5065MG', 'HS-85BB', 'HS-225BB', 'HS-77BB', 'HS-311', 'HS-322HD', 'HS-485HB', 'HS-5485HB', 'HS-625MG', 'HS-645MG', 'HS-5625MG', 'HS-5645MG']) expect(models).toContain(m)
    // each once, with a sensible case and lugs wider than it
    expect(new Set(models).size).toBe(models.length)
    for (const s of HITEC) expect(s.lugSpan).toBeGreaterThan(s.body[0])
  })
})

describe('Hitec drawings', () => {
  it('gives every entry its drawn lugs, output and lead, none estimated', () => {
    for (const s of HITEC) {
      expect(s.lugEstimated, s.model).toBeUndefined()
      const [l, , h] = s.body
      expect(s.lugThickness, s.model).toBeGreaterThan(0.0005)
      expect(s.lugThickness, s.model).toBeLessThan(0.003)
      // The lugs sit part way up the case, their top below its top
      expect(s.lugHeight, s.model).toBeGreaterThan(0)
      expect(s.lugHeight + s.lugThickness, s.model).toBeLessThanOrEqual(h + 1e-9)
      // A gear tower stands on the case, never the other way round
      expect(s.caseHeight, s.model).toBeLessThanOrEqual(h)
      expect(s.caseHeight, s.model).toBeGreaterThan(s.lugHeight)
      // The output is on the case, towards the lead end, and stands above it
      expect(s.output.offset, s.model).toBeGreaterThan(0)
      expect(s.output.offset, s.model).toBeLessThan(l / 2)
      expect(s.output.top, s.model).toBeGreaterThan(h)
      expect(s.output.diameter, s.model).toBeGreaterThan(0.003)
      expect(['end', 'base'], s.model).toContain(s.lead.exit)
      if (s.lead.exit === 'end') expect(s.lead.at, s.model).toBeLessThan(h)
      else expect(Math.abs(s.lead.at), s.model).toBeLessThan(l / 2)
    }
  })

  it('holds the figures printed on the drawings, in metres', () => {
    const by = (m) => HITEC.find((s) => s.model === m)
    const hs85 = by('HS-85MG')
    expect(hs85.body).toEqual([0.029, 0.013, 0.0294])
    expect(hs85.lugSpan).toBe(0.0398)
    expect(hs85.lugHeight).toBe(0.0192)
    expect(hs85.lugThickness).toBe(0.002)
    expect(hs85.output.top).toBe(0.0335)
    const hs65 = by('HS-65MG')
    expect(hs65.caseHeight).toBe(0.02)
    expect(hs65.body[2]).toBe(0.026)
    expect(by('HS-645MG').lugSpan).toBe(0.0534)
    expect(by('HS-77BB').lugThickness).toBe(0.0025)
    // Families share a case
    expect(by('HS-5625MG').body).toEqual(by('HS-645MG').body)
    expect(by('HS-322HD').lugSpan).toBe(by('HS-311').lugSpan)
  })

  it('gives the wing servos their standing lugs: a tab at the bottom or a second pair', () => {
    const wing = HITEC.filter((s) => s.wingLugs)
    expect(wing.map((s) => s.model).sort()).toEqual(['D141SW', 'D145SW', 'HS-125MG', 'HS-5125MG', 'HS-7115TH'])
    for (const s of wing) {
      expect(s.thin).toBe(true)
      // The upper pair's lower edge is the lug height
      expect(s.lugHeight + s.wingLugs.length).toBeCloseTo(s.body[2], 9)
      if (s.wingLugs.bottom === 'tab') expect(s.wingLugs.tab.every((v) => v > 0)).toBe(true)
      else expect(s.wingLugs.bottom).toBe('lugs')
    }
    expect(HITEC.find((s) => s.model === 'D141SW').drawing).toBe('D141SH')
  })
})

describe('servo shapes', () => {
  const extent = (parts, i) => [Math.min(...parts.filter((p) => p.box).map((p) => p.box[i][0])), Math.max(...parts.filter((p) => p.box).map((p) => p.box[i][1]))]

  it('builds an upright servo: case, lugs either side at their height, output boss and lead', () => {
    const f = servoFrame(servoById('hitec-hs-645mg'))
    const parts = servoParts(f)
    expect(parts[0]).toEqual({ kind: 'servo', box: [[-0.0204, 0.0204], [-0.01, 0.01], [0, 0.0378]] })
    const lugs = parts.slice(1).filter((p) => p.kind === 'servo')
    expect(lugs).toHaveLength(2)
    for (const l of lugs) expect(l.box[2]).toEqual([0.027, 0.0295])
    expect(extent(lugs, 0)).toEqual([-0.0267, 0.0267])
    const out = parts.find((p) => p.kind === 'servoOutput').cylinder
    expect(out).toMatchObject({ x: 0.01, y: 0, r: 0.006, z: [0.0378, 0.0428] })
    expect(parts.filter((p) => p.kind === 'servoLead')).toHaveLength(1)
  })

  it('gives a generic class a shape from its sizes', () => {
    const f = servoFrame({ id: 'micro', ...SERVOS.micro })
    expect(f.length).toBe(SERVOS.micro.length)
    expect(f.lugHeight).toBe(SERVOS.micro.lugHeight)
    expect(f.output.top).toBeGreaterThan(f.height)
    const parts = servoParts(f)
    expect(parts.filter((p) => p.kind === 'servo')).toHaveLength(3)
    expect(extent(parts.filter((p) => p.kind === 'servo'), 0)).toEqual([-SERVOS.micro.lugSpan / 2, SERVOS.micro.lugSpan / 2])
  })

  it('stands a wing servo\'s lugs in its middle plane, with the tab below its base', () => {
    const parts = servoParts(servoFrame(servoById('hitec-hs-125mg')))
    const lugs = parts.filter((p) => p.kind === 'servo').slice(1)
    expect(lugs).toHaveLength(3)
    for (const l of lugs) expect(l.box[1]).toEqual([-0.001, 0.001])
    const tab = lugs.find((l) => l.box[2][1] === 0)
    expect(tab.box[2]).toEqual([-0.006, 0])
    // D145SW has a second pair at the bottom instead
    const d145 = servoParts(servoFrame(servoById('hitec-d145sw'))).filter((p) => p.kind === 'servo')
    expect(d145).toHaveLength(5)
    // and its lead leaves through the base
    const lead = servoParts(servoFrame(servoById('hitec-d145sw'))).find((p) => p.kind === 'servoLead').box
    expect(lead[2][1]).toBe(0)
  })
})

describe('servoById', () => {
  it('returns a Hitec entry by its id', () => {
    expect(servoById('hitec-hs-85mg')).toBe(HITEC.find((s) => s.model === 'HS-85MG'))
  })

  it('returns a generic class under its key, with the id set', () => {
    const s = servoById('mini')
    expect(s.id).toBe('mini')
    expect(s.width).toBe(SERVOS.mini.width)
  })

  it('returns null for an unknown id', () => {
    expect(servoById('not-a-servo')).toBeNull()
  })
})

describe('servoEnvelope', () => {
  const s = { length: 0.03, width: 0.01, height: 0.04, thin: false }

  it('stands an upright servo on its base', () => {
    expect(servoEnvelope(s)).toEqual({ chord: 0.03, span: 0.01, depth: 0.04 })
    expect(servoEnvelope(s, 'upright')).toEqual(servoEnvelope(s))
  })

  it('lies a servo on its side', () => {
    expect(servoEnvelope(s, 'side')).toEqual({ chord: 0.03, span: 0.04, depth: 0.01 })
  })

  it('gives a flat envelope for a servo that is not a thin wing servo', () => {
    expect(servoEnvelope(s, 'flat')).toEqual({ chord: 0.04, span: 0.03, depth: 0.01 })
  })

  it('lays a thin wing servo flat, its long side across the span', () => {
    const thin = { ...s, thin: true }
    expect(servoEnvelope(thin, 'flat')).toEqual({ chord: 0.04, span: 0.03, depth: 0.01 })
  })

  it('names every mounting it accepts', () => {
    expect(Object.keys(MOUNTINGS)).toEqual(['upright', 'side', 'flat'])
  })
})

describe('servoOptions', () => {
  it('lists every generic class, then every Hitec servo, with unique values', () => {
    const opts = servoOptions()
    expect(opts.length).toBe(SERVO_CLASSES.length + HITEC.length)
    expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length)
    expect(opts.filter((o) => o.group === 'Generic').map((o) => o.value)).toEqual(SERVO_CLASSES)
    expect(opts.filter((o) => o.group.startsWith('Hitec')).map((o) => o.value)).toEqual(HITEC.map((s) => s.id))
    // Thin wing servos in a group of their own
    expect(opts.filter((o) => /wing servos/.test(o.group)).every((o) => HITEC.find((s) => s.id === o.value).thin)).toBe(true)
  })

  it('labels a Hitec servo by its model, weight and torque, and a generic class by its size', () => {
    const opts = servoOptions()
    expect(opts.find((o) => o.value === 'hitec-hs-85mg').label).toBe('HS-85MG, 22 g, 3.5 kg·cm')
    expect(opts.find((o) => o.value === 'micro').label).toBe(`${SERVOS.micro.label} (${SERVOS.micro.size})`)
  })
})

describe('defaultServoClass', () => {
  it('picks the class that suits each all-up mass', () => {
    expect(defaultServoClass(0.5)).toBe('sub-micro')
    expect(defaultServoClass(0.6)).toBe('sub-micro')
    expect(defaultServoClass(0.61)).toBe('micro')
    expect(defaultServoClass(2.5)).toBe('micro')
    expect(defaultServoClass(3)).toBe('mini')
    expect(defaultServoClass(6)).toBe('mini')
    expect(defaultServoClass(7)).toBe('standard')
  })

  it('falls back to micro for no usable mass', () => {
    expect(defaultServoClass(0)).toBe('micro')
    expect(defaultServoClass(NaN)).toBe('micro')
  })
})

describe('bay settings', () => {
  it('gives a surface its defaults when it has no saved bay', () => {
    expect(bayOf({ bays: [] }, 'aileron')).toEqual({ surface: 'aileron', enabled: true, class: null, mounting: 'upright', along: null, at: null })
    expect(bayOf(undefined, 'aileron').enabled).toBe(true)
  })

  it('saves only the settings that differ from the defaults', () => {
    const c = setBay({ bays: [] }, 'aileron', { class: 'mini' })
    expect(c.bays).toEqual([{ surface: 'aileron', class: 'mini' }])
  })

  it('drops a bay whose settings have come back to the defaults', () => {
    const c = setBay({ bays: [{ surface: 'aileron', class: 'mini' }] }, 'aileron', { class: null })
    expect(c.bays).toEqual([])
  })

  it('saves a removed bay as enabled false', () => {
    const c = setBay({ bays: [] }, 'flap', { enabled: false })
    expect(c.bays).toEqual([{ surface: 'flap', enabled: false }])
    expect(bayOf(c, 'flap').enabled).toBe(false)
  })

  it('keeps the other surfaces when one changes', () => {
    const start = { bays: [{ surface: 'a', class: 'standard' }] }
    const c = setBay(start, 'b', { class: 'micro' })
    expect(c.bays).toEqual([{ surface: 'a', class: 'standard' }, { surface: 'b', class: 'micro' }])
  })

  it('drops the bay of a surface that has gone', () => {
    const c = dropBay({ bays: [{ surface: 'a', class: 'mini' }, { surface: 'b', class: 'micro' }] }, 'a')
    expect(c.bays).toEqual([{ surface: 'b', class: 'micro' }])
  })
})

describe('the servo a bay holds', () => {
  it('turns a servo to its mounting: on its side it needs its width of depth, not its height', () => {
    const up = installedServo('standard', 'upright')
    const side = installedServo('standard', 'side')
    // Upright it needs its case and the output boss on top of it
    expect(up.height).toBeCloseTo(up.frame.output.top, 9)
    expect(up.height).toBeGreaterThan(SERVOS.standard.height)
    expect(side.height).toBe(SERVOS.standard.width)
    // On its side its height lies across the span, the boss beyond it, centred on the case
    expect(side.width).toBeGreaterThanOrEqual(SERVOS.standard.height)
    expect(side.lugHeight).toBeLessThan(side.height)
  })

  it('lays a thin Hitec wing servo flat, and lays a thick one flat too', () => {
    const thin = HITEC.find((s) => s.thin)
    const flat = installedServo(thin.id, 'flat')
    expect(flat.mounting).toBe('flat')
    expect(flat.height).toBe(Math.min(...thin.body))
    expect(flat.mass).toBe(thin.mass)
    const thick = HITEC.find((s) => !s.thin)
    expect(installedServo(thick.id, 'flat').mounting).toBe('flat')
  })

  it('falls back to the class that suits the weight for an unknown or empty choice', () => {
    expect(installedServo(null, 'upright', 5).label).toBe(SERVOS.mini.label)
    expect(installedServo('no-such-servo', 'upright', 0.4).label).toBe(SERVOS['sub-micro'].label)
  })
})
