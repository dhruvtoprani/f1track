import { describe, expect, it } from 'vitest'
import { analyzeCircuit } from '../engine/geometry'
import { circuitPresets } from './presets'
import {
  getLearnedDriverPrior,
  mlModelSummary,
  predictFinishPercentile,
  predictIncidentProbability,
  predictNextCompoundProbabilities,
  predictOvertakesPerLap,
  predictPitProbability,
  predictQualifyingPercentile,
  predictStartingCompoundProbabilities,
  predictTyrePaceResidual,
} from './mlRuntime'

const track = analyzeCircuit(circuitPresets[0])
const context = {
  track,
  gridPosition: 3,
  fieldSize: 22,
  driverCode: 'VER',
  teamName: 'Red Bull Racing',
  trackTemp: 36,
  rainfall: 0,
}

describe('trained ML runtime', () => {
  it('loads a versioned OpenF1 artifact with historical coverage', () => {
    expect(mlModelSummary.version).toMatch(/^APEX-ML-/)
    expect(mlModelSummary.data.source).toBe('OpenF1')
    expect(mlModelSummary.data.races).toBeGreaterThanOrEqual(50)
    expect(mlModelSummary.data.source_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(mlModelSummary.method.short_name).toBe('T-REK')
    expect(mlModelSummary.evaluation.qualifying.mae).toBeLessThan(0.14)
    expect(mlModelSummary.evaluation.tyre.mae).toBeLessThan(0.61)
    expect(getLearnedDriverPrior('VER')?.samples).toBeGreaterThan(20)
  })

  it('executes all exported model families with valid outputs', () => {
    expect(predictFinishPercentile(context)).toBeGreaterThanOrEqual(0)
    expect(predictFinishPercentile(context)).toBeLessThanOrEqual(1)
    expect(predictQualifyingPercentile(context)).toBeGreaterThanOrEqual(0)
    expect(predictQualifyingPercentile(context)).toBeLessThanOrEqual(1)
    expect(Number.isFinite(predictTyrePaceResidual(context, 'M', 18, 0.45))).toBe(true)
    expect(predictPitProbability(context, 'M', 18, 0.45)).toBeGreaterThanOrEqual(0)
    expect(predictPitProbability(context, 'M', 18, 0.45)).toBeLessThanOrEqual(1)
    const compounds = predictStartingCompoundProbabilities(context)
    expect(Object.values(compounds).reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 10)
    Object.values(compounds).forEach((probability) => expect(probability).toBeGreaterThanOrEqual(0))
    const nextCompounds = predictNextCompoundProbabilities(context, 'M', 18, 0.45)
    expect(Object.values(nextCompounds).reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 10)
    expect(predictIncidentProbability(context)).toBeGreaterThanOrEqual(0)
    expect(predictIncidentProbability(context)).toBeLessThanOrEqual(1)
    expect(predictOvertakesPerLap(context)).toBeGreaterThanOrEqual(0)
  })
})
