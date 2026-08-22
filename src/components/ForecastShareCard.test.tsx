import { describe, expect, it } from 'vitest'
import { circuitPresets } from '../data/presets'
import { analyzeCircuit } from '../engine/geometry'
import { runMonteCarlo, simulateQualifying } from '../engine/simulator'
import type { SimulationPackage } from '../types'
import { createForecastCardSvg } from './ForecastShareCard'

describe('forecast share card', () => {
  it('embeds the authored track, result, and paired strategy while escaping user text', async () => {
    const circuit = { ...circuitPresets[0], name: 'Toprani & <International>' }
    const track = analyzeCircuit(circuit)
    const grid = simulateQualifying(circuit, track, 'dry', 310)
    const baselineMonteCarlo = await runMonteCarlo(circuit, track, grid, 'dry', 120, undefined, 311)
    const monteCarlo = await runMonteCarlo(circuit, track, grid, 'dry', 120, undefined, 311, { teamId: 'mclaren', mode: 'attack' })
    const simulation = {
      id: 'share-card-test',
      createdAt: '2026-08-21T00:00:00.000Z',
      circuit,
      track,
      weatherMode: 'dry',
      seed: 311,
      grid,
      durationMs: 1,
      monteCarloRuns: 120,
      monteCarlo,
      baselineMonteCarlo,
      strategyScenario: { teamId: 'mclaren', mode: 'attack' },
      calibration: {} as SimulationPackage['calibration'],
    } satisfies SimulationPackage

    const svg = createForecastCardSvg(simulation)

    expect(svg).toContain('width="1200" height="630"')
    expect(svg).toContain('TOPRANI &amp; &lt;INTERNATIONAL&gt;')
    expect(svg).not.toContain('TOPRANI & <INTERNATIONAL>')
    expect(svg).toContain('YOUR TRACK')
    expect(svg).toContain('<path d="M')
    expect(svg).toContain('MCL · MAXIMUM ATTACK')
    expect(svg).toContain('120 WORLDS')
    expect(svg).toContain('APEX-RACE-LAB.VERCEL.APP')
  })
})
