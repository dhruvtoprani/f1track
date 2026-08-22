import { drivers, teamById } from '../data/grid'
import {
  predictFinishPercentile,
  predictIncidentProbability,
  predictNextCompoundProbabilities,
  predictOvertakesPerLap,
  predictPitProbability,
  predictQualifyingPercentile,
  predictStartingCompoundProbabilities,
  predictTyrePaceResidual,
  mlModelSummary,
  type MLContext,
} from '../data/mlRuntime'
import type {
  CircuitDraft,
  Compound,
  ExplanationTerm,
  FeaturedRace,
  GridEntry,
  MonteCarloEntry,
  MonteCarloProgress,
  RaceDriverSnapshot,
  RaceEvent,
  RaceResult,
  RaceSnapshot,
  StrategyScenario,
  TrackAnalysis,
  WeatherMode,
} from '../types'
import { hashSeed, SeededRandom } from './random'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const sigmoid = (value: number) => 1 / (1 + Math.exp(-value))
const dryCompounds: Compound[] = ['S', 'M', 'H']

const modelContext = (
  driverId: string,
  track: TrackAnalysis,
  gridPosition: number,
  trackTemp: number,
  rainfall: number,
): MLContext => {
  const driver = drivers.find((item) => item.id === driverId)!
  const team = teamById.get(driver.teamId)!
  return { track, gridPosition, fieldSize: drivers.length, driverCode: driver.code, teamName: team.name, trackTemp, rainfall }
}

export const formatLapTime = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '—'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, '0')}`
}

export const formatGap = (seconds: number): string => {
  if (seconds === 0) return 'LEADER'
  if (!Number.isFinite(seconds)) return 'DNF'
  return `+${seconds.toFixed(seconds >= 100 ? 0 : 3)}`
}

const driverRating = (driverId: string, track: TrackAnalysis, weather: WeatherMode) => {
  const driver = drivers.find((item) => item.id === driverId)!
  const team = teamById.get(driver.teamId)!
  const car = team.car
  const highWeight = track.highSpeedShare
  const lowWeight = track.lowSpeedShare
  const straightWeight = track.straightShare
  const carFit = (
    car.baseline * 0.28 + car.highSpeed * highWeight * 0.24 + car.lowSpeed * lowWeight * 0.2
    + car.power * straightWeight * 0.18 + car.traction * lowWeight * 0.14 + car.tyreLife * (track.tyreStress / 100) * 0.1
  ) / (0.28 + highWeight * 0.24 + lowWeight * 0.34 + straightWeight * 0.18 + track.tyreStress / 100 * 0.1)
  const driverFit = driver.skill.pace * 0.36 + driver.skill.qualifying * 0.2 + driver.skill.racecraft * 0.16
    + driver.skill.tyreManagement * (track.tyreStress / 100) * 0.17
    + (weather === 'dry' ? driver.skill.consistency : driver.skill.wet) * 0.11
  const score = carFit * 0.61 + driverFit * 0.39
  const suitability = clamp(50 + (carFit - car.baseline) * 3.4 + (driverFit - driver.skill.pace) * 2.2, 22, 91)
  return { score, suitability, carFit, driverFit }
}

const qualifyingAttempt = (
  driverId: string,
  track: TrackAnalysis,
  weather: WeatherMode,
  random: SeededRandom,
  evolution: number,
) => {
  const driver = drivers.find((item) => item.id === driverId)!
  const { score } = driverRating(driverId, track, weather)
  const fieldReference = 96.5
  const learnedQualifying = predictQualifyingPercentile(modelContext(
    driverId,
    track,
    11,
    weather === 'wet' ? 22 : 37,
    weather === 'wet' ? 0.65 : weather === 'dynamic' ? 0.12 : 0,
  ))
  const performanceDelta = (fieldReference - score) * 0.063 + (learnedQualifying - 0.3) * 2.8
  const weatherPenalty = weather === 'wet' ? 12.5 : weather === 'dynamic' ? 2.2 : 0
  const executionSigma = 0.09 + (100 - driver.skill.consistency) * 0.012 + track.oodScore * 0.14
  return track.expectedLapSeconds + performanceDelta + weatherPenalty - evolution + random.normal(0, executionSigma)
}

export const predictStartingCompound = (
  driverId: string,
  gridPosition: number,
  track: TrackAnalysis,
  weather: WeatherMode,
  random: SeededRandom,
): Compound => {
  if (weather === 'wet') return random.chance(0.75) ? 'W' : 'I'
  if (weather === 'dynamic' && random.chance(0.12)) return 'I'
  const learned = predictStartingCompoundProbabilities(modelContext(driverId, track, gridPosition, 37, 0))
  const learnedDryTotal = Math.max(0.0001, learned.S + learned.M + learned.H)
  const heuristicSoft = clamp(0.3 - track.tyreStress / 260 + (gridPosition > 14 ? 0.16 : 0), 0.04, 0.34)
  const heuristicHard = clamp(track.tyreStress / 260 + (gridPosition > 10 ? 0.08 : -0.04), 0.12, 0.46)
  const softProbability = 0.72 * learned.S / learnedDryTotal + 0.28 * heuristicSoft
  const hardProbability = 0.72 * learned.H / learnedDryTotal + 0.28 * heuristicHard
  const roll = random.next()
  if (roll < softProbability) return 'S'
  if (roll > 1 - hardProbability) return 'H'
  return 'M'
}

export const simulateQualifying = (
  circuit: CircuitDraft,
  track: TrackAnalysis,
  weather: WeatherMode,
  seed = hashSeed(`${circuit.id}:qualifying:${weather}`),
): GridEntry[] => {
  const random = new SeededRandom(seed)
  const rounds: Record<string, { q1?: number; q2?: number; q3?: number }> = Object.fromEntries(drivers.map((driver) => [driver.id, {}]))
  let active = drivers.map((driver) => driver.id)
  const stages = [
    { name: 'q1' as const, advance: 16, attempts: 2, evolution: 0.12 },
    { name: 'q2' as const, advance: 10, attempts: 2, evolution: 0.28 },
    { name: 'q3' as const, advance: 10, attempts: 2, evolution: 0.44 },
  ]
  const eliminated: { driverId: string; time: number; stage: number }[] = []

  stages.forEach((stage, stageIndex) => {
    const times = active.map((driverId) => {
      const attempts = Array.from({ length: stage.attempts }, (_, attempt) => qualifyingAttempt(driverId, track, weather, random, stage.evolution + attempt * 0.06))
      const time = Math.min(...attempts)
      rounds[driverId][stage.name] = time
      return { driverId, time }
    }).sort((a, b) => a.time - b.time)
    if (stageIndex < stages.length - 1) {
      const survivors = times.slice(0, stage.advance)
      eliminated.push(...times.slice(stage.advance).map((entry) => ({ ...entry, stage: stageIndex })))
      active = survivors.map((entry) => entry.driverId)
    } else {
      eliminated.push(...times.map((entry) => ({ ...entry, stage: stageIndex })))
    }
  })

  const ordered = eliminated.sort((a, b) => b.stage - a.stage || a.time - b.time)
  const pole = ordered[0].time
  return ordered.map((entry, index) => {
    const rating = driverRating(entry.driverId, track, weather)
    return {
      driverId: entry.driverId,
      position: index + 1,
      lapSeconds: entry.time,
      gapSeconds: entry.time - pole,
      rounds: rounds[entry.driverId],
      startingCompound: predictStartingCompound(entry.driverId, index + 1, track, weather, random),
      paceRating: rating.score,
      suitability: rating.suitability,
    }
  })
}

type InternalDriver = {
  driverId: string
  elapsed: number
  position: number
  previousPosition: number
  compound: Compound
  tyreAge: number
  stops: number
  strategy: Compound[]
  bestLap: number
  lastLap: number
  status: 'running' | 'finished' | 'dnf'
  failureLap?: number
  pitTarget: number
}

const tyrePenalty = (
  driverId: string,
  gridPosition: number,
  compound: Compound,
  age: number,
  track: TrackAnalysis,
  wetness: number,
  trackTemp: number,
  raceProgress: number,
) => {
  if (wetness > 0.62) {
    if (compound === 'W') return 0.4 + age * 0.045
    if (compound === 'I') return 3.4 + age * 0.06
    return 18 + wetness * 15
  }
  if (wetness > 0.13) {
    if (compound === 'I') return 0.35 + age * 0.055
    if (compound === 'W') return 2.2 + age * 0.07
    return 6 + wetness * 11
  }
  if (compound === 'I' || compound === 'W') return 7.5 + age * 0.1
  const base = compound === 'S' ? -0.72 : compound === 'M' ? 0 : 0.62
  const life = compound === 'S' ? 18 : compound === 'M' ? 30 : 43
  const normalizedAge = age / life
  const physicalPrior = base + age * 0.018 * (track.tyreStress / 55) + Math.max(0, normalizedAge - 0.65) ** 2 * 5.8
  const learnedResidual = predictTyrePaceResidual(
    modelContext(driverId, track, gridPosition, trackTemp, wetness),
    compound,
    age,
    raceProgress,
  )
  const learnedWeight = clamp(0.28 + mlModelSummary.evaluation.tyre.r2 * 0.8, 0.22, 0.48)
  return physicalPrior * (1 - learnedWeight) + clamp(learnedResidual, -1.5, 7) * learnedWeight
}

const nextDryCompound = (current: Compound, stops: number, stress: number): Compound => {
  if (current === 'S') return stress > 76 && stops === 0 ? 'M' : 'H'
  if (current === 'H') return stops === 0 ? 'M' : 'S'
  return stress > 72 && stops === 0 ? 'H' : 'S'
}

const shouldPit = (
  state: InternalDriver,
  lap: number,
  totalLaps: number,
  wetness: number,
  raceControl: 'GREEN' | 'VSC' | 'SC',
  track: TrackAnalysis,
  trackTemp: number,
  random: SeededRandom,
) => {
  if (state.status !== 'running') return false
  const wetTyre = state.compound === 'I' || state.compound === 'W'
  if (wetness > 0.62 && state.compound !== 'W') return true
  if (wetness > 0.14 && wetness <= 0.62 && state.compound !== 'I') return true
  if (wetness < 0.08 && wetTyre) return true
  if (lap >= totalLaps - 2) return false
  const ageLimit = state.compound === 'S' ? 17 : state.compound === 'M' ? 29 : 41
  const stressAdjusted = ageLimit * (1.2 - track.tyreStress / 250)
  const planned = lap >= state.pitTarget
  const hazard = sigmoid((state.tyreAge - stressAdjusted) * 0.42)
  const learnedHazard = predictPitProbability(
    modelContext(state.driverId, track, state.position, trackTemp, wetness),
    state.compound,
    state.tyreAge,
    lap / totalLaps,
  )
  const cheapStopBoost = raceControl === 'SC' ? 0.43 : raceControl === 'VSC' ? 0.19 : 0
  const learnedSignal = clamp((learnedHazard - 0.5) * 0.3, -0.1, 0.15)
  return planned || random.chance(clamp(hazard * 0.17 + learnedSignal + cheapStopBoost, 0, 0.8))
}

const newCompound = (
  state: InternalDriver,
  wetness: number,
  track: TrackAnalysis,
  trackTemp: number,
  raceProgress: number,
  random: SeededRandom,
) => {
  if (wetness > 0.62) return 'W' as Compound
  if (wetness > 0.13) return 'I' as Compound
  const learned = predictNextCompoundProbabilities(
    modelContext(state.driverId, track, state.position, trackTemp, wetness),
    state.compound,
    state.tyreAge,
    raceProgress,
  )
  const dryTotal = Math.max(0.0001, learned.S + learned.M + learned.H)
  const fallback = nextDryCompound(state.compound, state.stops, track.tyreStress)
  const probabilities = dryCompounds.map((compound) => ({
    compound,
    probability: 0.82 * learned[compound] / dryTotal + 0.18 * Number(compound === fallback),
  }))
  const roll = random.next()
  let cumulative = 0
  for (const option of probabilities) {
    cumulative += option.probability
    if (roll <= cumulative) return option.compound
  }
  return fallback
}

const pointsForPosition = (position: number) => [25, 18, 15, 12, 10, 8, 6, 4, 2, 1][position - 1] ?? 0

export const simulateFeaturedRace = (
  circuit: CircuitDraft,
  track: TrackAnalysis,
  grid: GridEntry[],
  weatherMode: WeatherMode,
  seed = hashSeed(`${circuit.id}:featured:${weatherMode}`),
): FeaturedRace => {
  const random = new SeededRandom(seed)
  const totalLaps = track.raceLaps
  const representative = grid[Math.floor(grid.length / 2)]
  const overtakeRate = predictOvertakesPerLap(modelContext(representative.driverId, track, representative.position, 34, 0))
  const incidentRaceProbability = new Map(grid.map((entry) => [entry.driverId, predictIncidentProbability(modelContext(
    entry.driverId,
    track,
    entry.position,
    weatherMode === 'wet' ? 22 : 37,
    weatherMode === 'wet' ? 0.65 : weatherMode === 'dynamic' ? 0.18 : 0,
  ))]))
  const states: InternalDriver[] = grid.map((entry) => {
    const driver = drivers.find((item) => item.id === entry.driverId)!
    const baseWindow = entry.startingCompound === 'S' ? 0.27 : entry.startingCompound === 'M' ? 0.43 : 0.58
    const team = teamById.get(driver.teamId)!
    return {
      driverId: entry.driverId,
      elapsed: (entry.position - 1) * 0.14,
      position: entry.position,
      previousPosition: entry.position,
      compound: entry.startingCompound,
      tyreAge: 0,
      stops: 0,
      strategy: [entry.startingCompound],
      bestLap: Number.POSITIVE_INFINITY,
      lastLap: Number.POSITIVE_INFINITY,
      status: 'running',
      pitTarget: Math.round(totalLaps * baseWindow + random.normal((100 - team.car.strategy) * 0.06, 1.5)),
    }
  })
  const events: RaceEvent[] = [{ id: 'start', lap: 1, type: 'start', headline: 'Lights out', detail: `${grid.length} cars begin the ${totalLaps}-lap race.`, tone: 'neutral' }]
  const snapshots: RaceSnapshot[] = []
  let wetness = weatherMode === 'wet' ? 0.72 : 0
  let rain = weatherMode === 'wet' ? 0.55 : 0
  let trackTemp = weatherMode === 'wet' ? 22 : 37
  let raceControl: 'GREEN' | 'VSC' | 'SC' = 'GREEN'
  let controlLaps = 0
  let lastWeatherLabel = wetness > 0.62 ? 'Wet' : wetness > 0.13 ? 'Damp' : 'Dry'

  for (let lap = 1; lap <= totalLaps; lap += 1) {
    if (weatherMode === 'dynamic') {
      const phase = lap / totalLaps
      const weatherWave = Math.max(0, Math.sin((phase * 2.15 - 0.28) * Math.PI))
      rain = clamp(weatherWave * 0.62 + random.normal(0, 0.035), 0, 0.9)
      wetness = clamp(wetness + rain * 0.1 - (0.035 + trackTemp / 1500), 0, 1)
      trackTemp = clamp(37 - rain * 15 + random.normal(0, 0.25), 18, 43)
    } else if (weatherMode === 'wet') {
      rain = clamp(0.5 + Math.sin(lap / 6) * 0.13, 0.25, 0.75)
      wetness = clamp(wetness + rain * 0.025 - 0.018, 0.55, 0.92)
    }
    const weatherLabel = wetness > 0.62 ? 'Wet' : wetness > 0.13 ? 'Damp' : 'Dry'
    if (weatherLabel !== lastWeatherLabel) {
      events.push({ id: `weather-${lap}`, lap, type: 'weather', headline: `Track declared ${weatherLabel.toLowerCase()}`, detail: `Surface wetness is ${Math.round(wetness * 100)}%. Strategy models are recalculating.`, tone: 'warning' })
      lastWeatherLabel = weatherLabel
    }

    if (controlLaps > 0) {
      controlLaps -= 1
      if (controlLaps === 0) {
        raceControl = 'GREEN'
        events.push({ id: `green-${lap}`, lap, type: 'race-control', headline: 'Green flag', detail: 'Racing resumes across the circuit.', tone: 'positive' })
      }
    }

    const pitting = states.filter((state) => shouldPit(state, lap, totalLaps, wetness, raceControl, track, trackTemp, random))
    const teamPitCounts = new Map<string, number>()
    pitting.forEach((state) => {
      const driver = drivers.find((item) => item.id === state.driverId)!
      teamPitCounts.set(driver.teamId, (teamPitCounts.get(driver.teamId) ?? 0) + 1)
    })

    for (const state of states) {
      if (state.status !== 'running') continue
      const driver = drivers.find((item) => item.id === state.driverId)!
      const team = teamById.get(driver.teamId)!
      const gridEntry = grid.find((entry) => entry.driverId === state.driverId)!
      const fuelPenalty = 3.65 * (1 - (lap - 1) / totalLaps)
      const tyre = tyrePenalty(state.driverId, gridEntry.position, state.compound, state.tyreAge, track, wetness, trackTemp, lap / totalLaps) * (1.1 - driver.skill.tyreManagement / 500)
      const baseRace = track.expectedLapSeconds + 4.15 + (96 - gridEntry.paceRating) * 0.12
      const gapAhead = state.position > 1 ? Math.max(0, state.elapsed - states.find((item) => item.position === state.position - 1)!.elapsed) : 9
      const learnedPassingFactor = clamp(1.35 - overtakeRate / 6, 0.62, 1.2)
      const traffic = gapAhead < 1.5 ? Math.exp(-gapAhead * 0.8) * (track.overtakingDifficulty / 64) * learnedPassingFactor : 0
      const execution = random.normal(0, 0.055 + (100 - driver.skill.consistency) * 0.009 + track.oodScore * 0.05)
      let lapTime = baseRace + fuelPenalty + tyre + traffic + execution
      const currentControl = raceControl as 'GREEN' | 'VSC' | 'SC'
      if (currentControl === 'SC') lapTime = track.expectedLapSeconds * 1.43 + state.position * 0.05
      if (currentControl === 'VSC') lapTime *= 1.28

      if (pitting.includes(state)) {
        const next = newCompound(state, wetness, track, trackTemp, lap / totalLaps, random)
        const doubleStack = (teamPitCounts.get(driver.teamId) ?? 0) > 1 && state.position > (states.find((item) => drivers.find((d) => d.id === item.driverId)?.teamId === driver.teamId && item.driverId !== state.driverId)?.position ?? 99)
        const serviceNoise = Math.max(-0.4, random.normal(0, 0.38 + (100 - team.car.strategy) * 0.02))
        const slowStop = random.chance((100 - team.car.strategy) / 900)
        const pitLoss = track.pitLossSeconds * (currentControl === 'SC' ? 0.58 : currentControl === 'VSC' ? 0.76 : 1) + serviceNoise + (slowStop ? random.between(2.5, 7.5) : 0) + (doubleStack ? random.between(1.2, 3.8) : 0)
        lapTime += pitLoss
        state.compound = next
        state.tyreAge = 0
        state.stops += 1
        state.strategy.push(next)
        state.pitTarget = Math.round(lap + totalLaps * (track.tyreStress > 74 ? 0.3 : 0.45) + random.normal(0, 1.2))
        events.push({
          id: `pit-${lap}-${state.driverId}`,
          lap,
          type: 'pit',
          driverId: state.driverId,
          headline: `${driver.code} pits for ${next}`,
          detail: `${pitLoss.toFixed(1)}s modeled loss${doubleStack ? ' including a double-stack delay' : ''}${slowStop ? ' after a slow service' : ''}.`,
          tone: slowStop || doubleStack ? 'warning' : 'neutral',
        })
      }

      const reliabilityHazard = (100 - team.car.reliability) / 42000
      const incidentHazard = (driver.skill.risk / 100) * (track.safetyCarLikelihood / 100) * (weatherLabel === 'Dry' ? 0.00055 : 0.0018)
      const learnedRaceHazard = -Math.log(1 - clamp(incidentRaceProbability.get(state.driverId) ?? 0.08, 0.005, 0.45)) / totalLaps
      const combinedHazard = (reliabilityHazard + incidentHazard) * 0.58 + learnedRaceHazard * 0.42
      if (lap > 1 && random.chance(combinedHazard)) {
        const mechanical = random.chance(reliabilityHazard / Math.max(0.00001, reliabilityHazard + incidentHazard))
        state.status = 'dnf'
        state.failureLap = lap
        state.elapsed += lapTime
        events.push({
          id: `dnf-${lap}-${state.driverId}`,
          lap,
          type: 'retirement',
          driverId: state.driverId,
          headline: `${driver.code} retires`,
          detail: mechanical ? 'A modeled reliability failure ends the race.' : 'Contact at a high-risk section ends the race.',
          tone: 'critical',
        })
        if (random.chance(track.safetyCarLikelihood / 100)) {
          raceControl = random.chance(0.68) ? 'SC' : 'VSC'
          controlLaps = raceControl === 'SC' ? random.integer(2, 4) : random.integer(1, 2)
          events.push({ id: `control-${lap}`, lap, type: 'race-control', headline: raceControl === 'SC' ? 'Safety car deployed' : 'Virtual safety car', detail: `Race control neutralizes the field for ${controlLaps} lap${controlLaps === 1 ? '' : 's'}.`, tone: 'warning' })
        }
        continue
      }

      state.lastLap = lapTime
      state.bestLap = Math.min(state.bestLap, lapTime)
      state.elapsed += lapTime
      state.tyreAge += 1
    }

    const running = states.filter((state) => state.status === 'running').sort((a, b) => a.elapsed - b.elapsed)
    const retired = states.filter((state) => state.status === 'dnf').sort((a, b) => (b.failureLap ?? 0) - (a.failureLap ?? 0))
    const previousPositions = new Map(states.map((state) => [state.driverId, state.position]))
    ;[...running, ...retired].forEach((state, index) => {
      state.previousPosition = previousPositions.get(state.driverId) ?? index + 1
      state.position = index + 1
    })
    if (raceControl === 'SC' && running.length) {
      const leaderTime = running[0].elapsed
      running.forEach((state, index) => { state.elapsed = leaderTime + index * 0.65 })
    }
    if (lap > 1) {
      running.filter((state) => state.position < state.previousPosition && state.position <= 12).slice(0, 3).forEach((state) => {
        const driver = drivers.find((item) => item.id === state.driverId)!
        events.push({ id: `pass-${lap}-${state.driverId}-${state.position}`, lap, type: 'overtake', driverId: state.driverId, headline: `${driver.code} moves to P${state.position}`, detail: `Pace and tyre delta create a pass in a ${track.passingZones.length ? 'modeled passing zone' : 'technical sequence'}.`, tone: 'positive' })
      })
    }

    const leader = running[0]?.elapsed ?? 0
    const order: RaceDriverSnapshot[] = [...running, ...retired].map((state, index, ordered) => {
      const previousElapsed = index > 0 && ordered[index - 1].status === 'running' ? ordered[index - 1].elapsed : state.elapsed
      const gap = state.status === 'running' ? state.elapsed - leader : Number.POSITIVE_INFINITY
      return {
        driverId: state.driverId,
        position: state.position,
        gapSeconds: gap,
        intervalSeconds: state.status === 'running' ? state.elapsed - previousElapsed : Number.POSITIVE_INFINITY,
        compound: state.compound,
        tyreAge: state.tyreAge,
        stops: state.stops,
        progress: state.status === 'running' ? ((0.012 - gap / Math.max(65, track.expectedLapSeconds)) + 1) % 1 : 0.74,
        lastLapSeconds: state.lastLap,
        bestLapSeconds: state.bestLap,
        status: state.status,
      }
    })
    snapshots.push({ lap, raceControl, weather: { label: weatherLabel, rain, wetness, trackTemp }, order })
  }

  const finalOrder = snapshots[snapshots.length - 1].order
  const leaderTime = states.find((state) => state.driverId === finalOrder[0].driverId)?.elapsed ?? 0
  const results: RaceResult[] = finalOrder.map((snapshot) => {
    const state = states.find((item) => item.driverId === snapshot.driverId)!
    return {
      driverId: snapshot.driverId,
      position: snapshot.position,
      status: state.status === 'dnf' ? `DNF · Lap ${state.failureLap}` : 'Finished',
      totalTime: state.elapsed,
      gapSeconds: state.status === 'dnf' ? Number.POSITIVE_INFINITY : state.elapsed - leaderTime,
      stops: state.stops,
      strategy: state.strategy,
      bestLapSeconds: state.bestLap,
      points: state.status === 'dnf' ? 0 : pointsForPosition(snapshot.position),
    }
  })
  const winner = drivers.find((driver) => driver.id === results[0].driverId)!
  events.push({ id: 'finish', lap: totalLaps, type: 'finish', driverId: winner.id, headline: `${winner.code} wins`, detail: `${circuit.name} produces a ${totalLaps}-lap race with ${events.filter((event) => event.type === 'overtake').length} recorded lead-group moves.`, tone: 'positive' })

  const explanations: Record<string, ExplanationTerm[]> = {}
  results.slice(0, 5).forEach((result) => {
    const rating = driverRating(result.driverId, track, weatherMode)
    const driver = drivers.find((item) => item.id === result.driverId)!
    const team = teamById.get(driver.teamId)!
    explanations[result.driverId] = [
      { label: track.highSpeedShare > track.lowSpeedShare ? 'High-speed geometry fit' : 'Low-speed geometry fit', seconds: (rating.suitability - 50) * 0.055, kind: rating.suitability >= 50 ? 'gain' : 'loss' },
      { label: 'Driver execution', seconds: (driver.skill.consistency - 88) * 0.12, kind: driver.skill.consistency >= 88 ? 'gain' : 'loss' },
      { label: 'Tyre management', seconds: (driver.skill.tyreManagement - 89) * track.tyreStress / 650, kind: driver.skill.tyreManagement >= 89 ? 'gain' : 'loss' },
      { label: 'Team strategy & service', seconds: (team.car.strategy - 88) * 0.11 - result.stops * 0.16, kind: team.car.strategy >= 89 ? 'gain' : 'loss' },
      { label: 'Traffic / race variance', seconds: result.position <= grid.find((entry) => entry.driverId === result.driverId)!.position ? 0.9 : -1.1, kind: result.position <= grid.find((entry) => entry.driverId === result.driverId)!.position ? 'gain' : 'loss' },
    ]
  })

  return { seed, snapshots, events: events.sort((a, b) => a.lap - b.lap), results, explanations }
}

type ProgressCallback = (progress: MonteCarloProgress) => void

type MonteCarloAccumulator = {
  wins: number
  podiums: number
  pointsFinishes: number
  dnfs: number
  finishTotal: number
  stopsTotal: number
  distribution: number[]
  strategies: Map<string, number>
}

const monteCarloSnapshot = (
  accumulators: Map<string, MonteCarloAccumulator>,
  completed: number,
): MonteCarloEntry[] => drivers.map((driver) => {
  const acc = accumulators.get(driver.id)!
  return {
    driverId: driver.id,
    wins: acc.wins / completed,
    podiums: acc.podiums / completed,
    pointsFinishes: acc.pointsFinishes / completed,
    dnfs: acc.dnfs / completed,
    averageFinish: acc.finishTotal / completed,
    averageStops: acc.stopsTotal / completed,
    finishDistribution: acc.distribution.map((count) => count / completed),
    strategyShares: Object.fromEntries(
      [...acc.strategies.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([key, count]) => [key, count / completed]),
    ),
  }
}).sort((a, b) => b.wins - a.wins || a.averageFinish - b.averageFinish)

export const runMonteCarlo = async (
  circuit: CircuitDraft,
  track: TrackAnalysis,
  grid: GridEntry[],
  weatherMode: WeatherMode,
  runs: number,
  onProgress?: ProgressCallback,
  seed = hashSeed(`${circuit.id}:monte-carlo:${weatherMode}:${runs}`),
  strategyScenario?: StrategyScenario,
): Promise<MonteCarloEntry[]> => {
  const random = new SeededRandom(seed)
  const startedAt = performance.now()
  const accumulators = new Map<string, MonteCarloAccumulator>(drivers.map((driver) => [driver.id, {
    wins: 0, podiums: 0, pointsFinishes: 0, dnfs: 0, finishTotal: 0, stopsTotal: 0,
    distribution: Array(drivers.length).fill(0) as number[], strategies: new Map<string, number>(),
  }]))
  // All invariant lookups and learned inference happen once per driver. The hot
  // loop below only samples race-level variance, which keeps 10k runs interactive.
  const profiles = grid.map((entry) => {
    const driver = drivers.find((item) => item.id === entry.driverId)!
    const team = teamById.get(driver.teamId)!
    const context = modelContext(
      entry.driverId,
      track,
      entry.position,
      weatherMode === 'wet' ? 22 : 37,
      weatherMode === 'wet' ? 0.65 : weatherMode === 'dynamic' ? 0.18 : 0,
    )
    return {
      entry,
      driver,
      team,
      rating: driverRating(entry.driverId, track, weatherMode).score,
      learnedFinish: predictFinishPercentile(context),
      learnedIncident: predictIncidentProbability(context),
      gridEffect: (drivers.length - entry.position) * (track.overtakingDifficulty / 100) * 0.22,
    }
  })
  const batch = Math.max(50, Math.min(250, Math.floor(runs / 40)))

  for (let run = 0; run < runs; run += 1) {
    const safetyCar = random.chance(track.safetyCarLikelihood / 190)
    const wetRace = weatherMode === 'wet' || (weatherMode === 'dynamic' && random.chance(0.58))
    const classified = profiles.map((profile) => {
      const { entry, driver, team } = profile
      const strategyMode = strategyScenario?.teamId === team.id ? strategyScenario.mode : 'balanced'
      const priorDnfProbability = clamp((100 - team.car.reliability) / 430 + (driver.skill.risk - 50) / 1700 + (wetRace ? 0.018 : 0), 0.01, 0.15)
      const attackHazard = strategyMode === 'attack' ? 0.004 : 0
      const dnfProbability = clamp(priorDnfProbability * 0.58 + profile.learnedIncident * 0.42 + attackHazard, 0.008, 0.24)
      const dnf = random.chance(dnfProbability)
      const baselineStops = wetRace ? random.integer(2, 4) : track.tyreStress > 76 ? (random.chance(0.72) ? 2 : 1) : (random.chance(0.18) ? 2 : 1)
      const strategicStops = wetRace
        ? baselineStops
        : strategyMode === 'undercut'
          ? Math.max(2, baselineStops)
          : strategyMode === 'tyre-save'
            ? 1
            : baselineStops
      const scenarioBonus = strategyMode === 'undercut'
        ? clamp(0.12 + track.overtakingDifficulty * 0.005 + track.tyreStress * 0.0025 - track.pitLossSeconds * 0.006, -0.18, 0.38)
        : strategyMode === 'tyre-save'
          ? clamp(-0.06 + (team.car.tyreLife - 85) * 0.008 + (70 - track.tyreStress) * 0.003, -0.18, 0.25)
          : strategyMode === 'attack'
            ? clamp(0.10 + track.passingZones.length * 0.025 + (100 - track.overtakingDifficulty) * 0.0007, 0.10, 0.28)
            : 0
      const strategyVariance = strategyMode === 'attack' ? 0.16 : strategyMode === 'tyre-save' ? -0.08 : 0
      const strategyEffect = team.car.strategy * 0.11 - strategicStops * 0.22 + scenarioBonus + random.normal(0, Math.max(0.75, (safetyCar ? 2.6 : 1.15) + strategyVariance))
      const wetSkill = wetRace ? driver.skill.wet * 0.16 : 0
      const learnedPerformance = (0.5 - profile.learnedFinish) * 12
      const score = profile.rating + learnedPerformance + driver.skill.racecraft * 0.17 + wetSkill + profile.gridEffect + strategyEffect + random.normal(0, 1.35 + track.oodScore * 2.3)
      const strategy = wetRace
        ? `${entry.startingCompound}→I→${random.chance(0.4) ? 'W' : 'M'}`
        : strategyMode === 'attack'
          ? strategicStops === 2 ? `${entry.startingCompound}→S→M` : `${entry.startingCompound}→M`
          : strategicStops === 2 ? `${entry.startingCompound}→M→H` : `${entry.startingCompound}→H`
      return { driverId: entry.driverId, dnf, score, stops: strategicStops, strategy }
    }).sort((a, b) => Number(a.dnf) - Number(b.dnf) || b.score - a.score)

    classified.forEach((result, index) => {
      const acc = accumulators.get(result.driverId)!
      const position = index + 1
      acc.wins += position === 1 ? 1 : 0
      acc.podiums += position <= 3 ? 1 : 0
      acc.pointsFinishes += position <= 10 ? 1 : 0
      acc.dnfs += result.dnf ? 1 : 0
      acc.finishTotal += position
      acc.stopsTotal += result.stops
      acc.distribution[position - 1] += 1
      acc.strategies.set(result.strategy, (acc.strategies.get(result.strategy) ?? 0) + 1)
    })

    if ((run + 1) % batch === 0 || run === runs - 1) {
      const completed = run + 1
      const elapsedMs = performance.now() - startedAt
      onProgress?.({
        completed,
        total: runs,
        progress: completed / runs,
        entries: monteCarloSnapshot(accumulators, completed),
        elapsedMs,
        racesPerSecond: completed / Math.max(0.001, elapsedMs / 1000),
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }

  return monteCarloSnapshot(accumulators, runs)
}
