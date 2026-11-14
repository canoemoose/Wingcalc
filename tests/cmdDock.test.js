// Where a drawing's command bar sits (src/composables/useCmdDock.js)
import { describe, it, expect } from 'vitest'
import { cmdCollides } from '../src/composables/useCmdDock.js'

describe('the command bar along the top', () => {
  it('stays there while it clears the corner controls, with a gap', () => {
    // A 400 px bar centred in 1000 px has 300 px each side
    expect(cmdCollides(1000, 400, 100, 0)).toBe(false)
    expect(cmdCollides(1000, 400, 280, 0)).toBe(false)
  })
  it('drops to the bottom where it would run into either corner', () => {
    expect(cmdCollides(1000, 400, 295, 0)).toBe(true)
    expect(cmdCollides(1000, 400, 0, 310)).toBe(true)
    expect(cmdCollides(600, 400, 100, 0)).toBe(true)
  })
})
