import { describe, expect, it } from 'vitest'
import { circuitPresets } from '../data/presets'
import { analyzeCircuit, ensureClosed, hasSelfIntersection, resampleClosedPath } from './geometry'

describe('circuit geometry', () => {
  it('closes and uniformly resamples an authored path', () => {
    const open = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    const closed = ensureClosed(open)
    expect(closed[0]).toEqual(closed[closed.length - 1])
    const samples = resampleClosedPath(open, 120)
    expect(samples).toHaveLength(120)
    expect(new Set(samples.map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)).size).toBeGreaterThan(100)
  })

  it('rejects planar self-intersections but accepts a normal loop', () => {
    const bowTie = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 0 }]
    const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }]
    expect(hasSelfIntersection(bowTie)).toBe(true)
    expect(hasSelfIntersection(square)).toBe(false)
  })

  it('derives a complete, physically scaled track profile', () => {
    const analysis = analyzeCircuit(circuitPresets[0])
    expect(analysis.valid).toBe(true)
    expect(analysis.normalizedPoints).toHaveLength(360)
    expect(analysis.sampleCount).toBe(Math.ceil(circuitPresets[0].lengthM / 2))
    expect(analysis.raceLaps).toBe(Math.ceil(305000 / circuitPresets[0].lengthM))
    expect(analysis.cornerCount).toBeGreaterThanOrEqual(4)
    expect(analysis.expectedLapSeconds).toBeGreaterThan(60)
    expect(analysis.expectedLapSeconds).toBeLessThan(180)
    expect(analysis.similarities).toHaveLength(3)
    expect(analysis.oodScore).toBeGreaterThan(0)
    expect(analysis.oodScore).toBeLessThan(1)
  })
})
