import { describe, expect, it } from 'vitest'
import { scalePathData } from '../pathScale'

describe('scalePathData (boolean / custom path resize)', () => {
  it('scales coordinates without baking stroke into the path', () => {
    // Closed ring in a 100×100 box → 200×50 (non-uniform).
    const d = 'M 10 10 L 90 10 L 90 90 L 10 90 Z'
    const next = scalePathData(d, 2, 0.5)
    expect(next).toBe('M 20 5 L 180 5 L 180 45 L 20 45 Z')
  })

  it('keeps relative structure for densified boolean polylines', () => {
    const d = 'M 0 0 L 100 0 L 100 20 L 0 20 Z'
    const next = scalePathData(d, 1.5, 1.5)
    expect(next).toContain('M 0 0')
    expect(next).toContain('L 150 0')
    expect(next).toContain('L 150 30')
  })
})
