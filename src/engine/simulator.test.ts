import { describe, expect, it } from 'vitest'
import { drivers } from '../data/grid'
import { circuitPresets } from '../data/presets'
import { analyzeCircuit } from './geometry'
import { runMonteCarlo, simulateFeaturedRace, simulateQualifying } from './simulator'

const circuit = circuitPresets[0]
const track = analyzeCircuit(circuit)

describe('race simulator', () => {
  it('builds a deterministic 22-car qualifying grid through three rounds', () => {
    const first = simulateQualifying(circuit, track, 'dry', 2026)
    const second = simulateQualifying(circuit, track, 'dry', 2026)
    expect(first).toEqual(second)
    expect(first).toHaveLength(drivers.length)
    expect(new Set(first.map((entry) => entry.driverId)).size).toBe(drivers.length)
    expect(first.map((entry) => entry.position)).toEqual(Array.from({ length: drivers.length }, (_, index) => index + 1))
    expect(first.slice(0, 10).every((entry) => entry.rounds.q3 !== undefined)).toBe(true)
    expect(first.slice(10).every((entry) => entry.rounds.q3 === undefined)).toBe(true)
  })

  it('runs a complete replay and preserves classification invariants', () => {
    const grid = simulateQualifying(circuit, track, 'dynamic', 73)
    const race = simulateFeaturedRace(circuit, track, grid, 'dynamic', 74)
    expect(race.snapshots).toHaveLength(track.raceLaps)
    expect(race.results).toHaveLength(drivers.length)
    expect(new Set(race.results.map((entry) => entry.driverId)).size).toBe(drivers.length)
    expect(race.results.map((entry) => entry.position)).toEqual(Array.from({ length: drivers.length }, (_, index) => index + 1))
    expect(race.events.some((event) => event.type === 'start')).toBe(true)
    expect(race.events.some((event) => event.type === 'finish')).toBe(true)
    expect(race.results.every((entry) => entry.strategy.length >= 1)).toBe(true)
    expect(race.snapshots.every((snapshot) => snapshot.order.length === drivers.length)).toBe(true)
  })

  it('aggregates normalized Monte Carlo distributions', async () => {
    const grid = simulateQualifying(circuit, track, 'dry', 91)
    const updates: number[] = []
    const aggregate = await runMonteCarlo(circuit, track, grid, 'dry', 120, (update) => {
      updates.push(update.completed)
      expect(update.entries.reduce((sum, entry) => sum + entry.wins, 0)).toBeCloseTo(1, 8)
      expect(update.racesPerSecond).toBeGreaterThan(0)
    }, 92)
    expect(updates).toEqual([50, 100, 120])
    expect(aggregate).toHaveLength(drivers.length)
    expect(aggregate.reduce((sum, entry) => sum + entry.wins, 0)).toBeCloseTo(1, 8)
    aggregate.forEach((entry) => {
      expect(entry.finishDistribution.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 8)
      expect(entry.averageFinish).toBeGreaterThanOrEqual(1)
      expect(entry.averageFinish).toBeLessThanOrEqual(drivers.length)
      expect(entry.dnfs).toBeGreaterThanOrEqual(0)
      expect(entry.dnfs).toBeLessThanOrEqual(1)
    })
  })

  it('isolates a selected team strategy against a paired baseline', async () => {
    const grid = simulateQualifying(circuit, track, 'dry', 2027)
    const baseline = await runMonteCarlo(circuit, track, grid, 'dry', 800, undefined, 2028)
    const balanced = await runMonteCarlo(circuit, track, grid, 'dry', 800, undefined, 2028, { teamId: 'mclaren', mode: 'balanced' })
    const attack = await runMonteCarlo(circuit, track, grid, 'dry', 800, undefined, 2028, { teamId: 'mclaren', mode: 'attack' })
    const mclarenIds = new Set(drivers.filter((driver) => driver.teamId === 'mclaren').map((driver) => driver.id))
    const teamWins = (entries: typeof baseline) => entries.reduce((sum, entry) => mclarenIds.has(entry.driverId) ? sum + entry.wins : sum, 0)

    expect(balanced).toEqual(baseline)
    expect(teamWins(attack)).not.toBe(teamWins(baseline))
    expect(attack.reduce((sum, entry) => sum + entry.wins, 0)).toBeCloseTo(1, 8)
  })
})
