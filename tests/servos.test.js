// The Hitec catalogue and its lookups: ids, mounting envelopes, the picker's options, the
// size class a model's mass suggests, and the saved bay settings. Bay placement itself is
// covered in servoBays.test.js.
import { describe, it, expect } from 'vitest'
import {
  SERVOS, SERVO_CLASSES, HITEC, MOUNTINGS,
  servoEnvelope, servoById, servoOptions, defaultServoClass, bayOf, setBay, dropBay, installedServo,
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
    expect(models).not.toContain('HS-625MG')
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
    expect(up.height).toBe(SERVOS.standard.height)
    expect(side.height).toBe(SERVOS.standard.width)
    expect(side.width).toBe(SERVOS.standard.height)
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
