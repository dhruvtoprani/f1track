export type Point = { x: number; y: number }
export type WeatherMode = 'dry' | 'wet' | 'dynamic'
export type StrategyMode = 'balanced' | 'undercut' | 'tyre-save' | 'attack'
export type Compound = 'S' | 'M' | 'H' | 'I' | 'W'
export type RaceControl = 'GREEN' | 'VSC' | 'SC'

export type StrategyScenario = {
  teamId: string
  mode: StrategyMode
}

export type CircuitDraft = {
  id: string
  name: string
  points: Point[]
  lengthM: number
  direction: 'clockwise' | 'counterclockwise'
  startFinishFraction: number
  pitEntryFraction: number
  pitExitFraction: number
  updatedAt: string
}

export type TrackZone = {
  id: number
  startFraction: number
  endFraction: number
  lengthM: number
  score: number
  label: string
}

export type TrackSimilarity = {
  name: string
  score: number
  profile: string
}

export type TrackAnalysis = {
  valid: boolean
  issues: string[]
  normalizedPoints: Point[]
  curvatures: number[]
  lengthM: number
  raceLaps: number
  sampleCount: number
  cornerCount: number
  longestStraightM: number
  averageSpeedKph: number
  expectedLapSeconds: number
  brakingSeverity: number
  downforceDemand: number
  powerSensitivity: number
  tractionSensitivity: number
  tyreStress: number
  overtakingDifficulty: number
  safetyCarLikelihood: number
  pitLossSeconds: number
  highSpeedShare: number
  lowSpeedShare: number
  straightShare: number
  oodScore: number
  passingZones: TrackZone[]
  similarities: TrackSimilarity[]
  character: string[]
}

export type Team = {
  id: string
  name: string
  shortName: string
  color: string
  accent: string
  currentPoints: number
  car: {
    baseline: number
    highSpeed: number
    lowSpeed: number
    power: number
    traction: number
    tyreLife: number
    reliability: number
    strategy: number
  }
}

export type Driver = {
  id: string
  code: string
  number: number
  firstName: string
  lastName: string
  nationality: string
  teamId: string
  currentPoints: number
  skill: {
    pace: number
    qualifying: number
    racecraft: number
    tyreManagement: number
    wet: number
    consistency: number
    risk: number
  }
}

export type GridEntry = {
  driverId: string
  position: number
  lapSeconds: number
  gapSeconds: number
  rounds: { q1?: number; q2?: number; q3?: number }
  startingCompound: Compound
  paceRating: number
  suitability: number
}

export type RaceDriverSnapshot = {
  driverId: string
  position: number
  gapSeconds: number
  intervalSeconds: number
  compound: Compound
  tyreAge: number
  stops: number
  progress: number
  lastLapSeconds: number
  bestLapSeconds: number
  status: 'running' | 'finished' | 'dnf'
}

export type RaceSnapshot = {
  lap: number
  raceControl: RaceControl
  weather: {
    label: string
    rain: number
    wetness: number
    trackTemp: number
  }
  order: RaceDriverSnapshot[]
}

export type RaceEventType =
  | 'start'
  | 'overtake'
  | 'pit'
  | 'incident'
  | 'retirement'
  | 'weather'
  | 'race-control'
  | 'finish'

export type RaceEvent = {
  id: string
  lap: number
  type: RaceEventType
  driverId?: string
  headline: string
  detail: string
  tone: 'neutral' | 'positive' | 'warning' | 'critical'
}

export type RaceResult = {
  driverId: string
  position: number
  status: string
  totalTime: number
  gapSeconds: number
  stops: number
  strategy: Compound[]
  bestLapSeconds: number
  points: number
}

export type ExplanationTerm = {
  label: string
  seconds: number
  kind: 'gain' | 'loss'
}

export type FeaturedRace = {
  seed: number
  snapshots: RaceSnapshot[]
  events: RaceEvent[]
  results: RaceResult[]
  explanations: Record<string, ExplanationTerm[]>
}

export type MonteCarloEntry = {
  driverId: string
  wins: number
  podiums: number
  pointsFinishes: number
  dnfs: number
  averageFinish: number
  averageStops: number
  finishDistribution: number[]
  strategyShares: Record<string, number>
}

export type MonteCarloProgress = {
  completed: number
  total: number
  progress: number
  entries: MonteCarloEntry[]
  elapsedMs: number
  racesPerSecond: number
}

export type SimulationPackage = {
  id: string
  createdAt: string
  circuit: CircuitDraft
  track: TrackAnalysis
  weatherMode: WeatherMode
  grid: GridEntry[]
  seed: number
  durationMs: number
  monteCarloRuns: number
  monteCarlo: MonteCarloEntry[]
  baselineMonteCarlo?: MonteCarloEntry[]
  strategyScenario: StrategyScenario
  calibration: {
    season: number
    modelVersion: string
    modelMethod: string
    confidence: number
    caveat: string
    dataSource: string
    trainedAt: string
    trainingRaces: number
    trainingRows: number
    holdout: {
      paceMae: number
      qualifyingMae: number
      tyreMae: number
      pitLogLoss: number
      startingCompoundAccuracy: number
    }
  }
}
