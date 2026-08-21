import type { Compound, TrackAnalysis } from '../types'
import artifactJson from './trained-model.json'

type LinearScalarModel = {
  type: 'ridge_regression' | 'logistic_regression'
  features: string[]
  mean: number[]
  std: number[]
  coefficients: number[]
  intercept: number
}

type TemporalKernelModel = {
  type: 'temporal_huber_kernel'
  features: string[]
  mean: number[]
  std: number[]
  projection: number[][]
  phase: number[]
  coefficients: number[]
  intercept: number
  spectral_dimensions: number
  gamma: number
  alpha: number
  huber_delta: number
  session_half_life: number
}

type ScalarModel = LinearScalarModel | TemporalKernelModel

type SoftmaxModel = {
  type: 'softmax_regression'
  features: string[]
  classes: Compound[]
  mean: number[]
  std: number[]
  coefficients: number[][]
  intercept: number[]
}

export type LearnedDriverPrior = {
  samples: number
  pace: number
  qualifying: number
  racecraft: number
  tyre_management: number
  wet: number
  consistency: number
  risk: number
  historical_finish_percentile: number
  historical_qualifying_percentile: number
  recent_finish_percentile: number
  recent_qualifying_percentile: number
  qualifying_trend: number
  racecraft_delta: number
}

export type LearnedTeamPrior = {
  samples: number
  baseline: number
  high_speed: number
  low_speed: number
  power: number
  traction: number
  tyre_life: number
  reliability: number
  strategy: number
  historical_finish_percentile: number
  historical_qualifying_percentile: number
  recent_finish_percentile: number
  recent_qualifying_percentile: number
  qualifying_trend: number
  racecraft_delta: number
}

type TrainedArtifact = {
  schema_version: number
  model_version: string
  trained_at: string
  seed: number
  method: {
    name: string
    short_name: string
    feature_map: string
    objective: string
    recency_weight: string
    outcome_decomposition: string
    selection: string
  }
  data: {
    source: string
    source_url: string
    seasons: number[]
    source_sha256: string
    pipeline_sha256: string
    source_as_of: string
    races: number
    pace_rows: number
    qualifying_rows: number
    tyre_rows: number
    pit_rows: number
    start_rows: number
    next_compound_rows: number
    driver_session_rows: number
  }
  evaluation: {
    pace: { mae: number; rmse: number; r2: number; train_rows: number; test_rows: number }
    qualifying: { mae: number; rmse: number; r2: number; train_rows: number; test_rows: number }
    tyre: { mae: number; rmse: number; r2: number; train_rows: number; test_rows: number }
    pit: { log_loss: number; accuracy: number; positive_rate: number; train_rows: number; test_rows: number }
    starting_compound: { accuracy: number; class_counts: Record<string, number>; train_rows: number; test_rows: number }
    next_compound: { accuracy: number; class_counts: Record<string, number>; train_rows: number; test_rows: number }
    incident: { log_loss: number; accuracy: number; positive_rate: number; train_rows: number; test_rows: number }
    overtake_rate: { mae: number; rmse: number; r2: number; train_rows: number; test_rows: number }
  }
  models: {
    pace: ScalarModel
    qualifying: ScalarModel
    tyre: ScalarModel
    pit_hazard: ScalarModel
    starting_compound: SoftmaxModel
    next_compound: SoftmaxModel
    incident: ScalarModel
    overtake_rate: ScalarModel
  }
  driver_priors: Record<string, LearnedDriverPrior>
  team_priors: Record<string, LearnedTeamPrior>
  limitations: string[]
}

const artifact = artifactJson as TrainedArtifact
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

const featureVector = (model: ScalarModel | SoftmaxModel, features: Record<string, number>) => (
  model.features.map((name, index) => ((features[name] ?? 0) - model.mean[index]) / model.std[index])
)

const scalarPrediction = (model: ScalarModel, features: Record<string, number>) => {
  const vector = featureVector(model, features)
  const design = model.type === 'temporal_huber_kernel' && model.phase.length > 0
    ? [
        ...vector,
        ...model.phase.map((phase, spectralIndex) => Math.sqrt(2 / model.phase.length) * Math.cos(
          phase + vector.reduce((sum, value, featureIndex) => (
            sum + value * model.projection[featureIndex][spectralIndex]
          ), 0),
        )),
      ]
    : vector
  return model.intercept + design.reduce((sum, value, index) => sum + value * model.coefficients[index], 0)
}

const softmaxPrediction = (model: SoftmaxModel, features: Record<string, number>) => {
  const vector = featureVector(model, features)
  const logits = model.classes.map((_, classIndex) => (
    model.intercept[classIndex] + vector.reduce((sum, value, featureIndex) => (
      sum + value * model.coefficients[featureIndex][classIndex]
    ), 0)
  ))
  const maximum = Math.max(...logits)
  const exponentials = logits.map((value) => Math.exp(value - maximum))
  const total = exponentials.reduce((sum, value) => sum + value, 0)
  return Object.fromEntries(model.classes.map((compound, index) => [compound, exponentials[index] / total])) as Record<Compound, number>
}

export type MLContext = {
  track: TrackAnalysis
  gridPosition: number
  fieldSize?: number
  driverCode: string
  teamName: string
  trackTemp: number
  rainfall: number
}

const contextFeatures = (context: MLContext) => {
  const gridPct = (context.gridPosition - 1) / Math.max(1, (context.fieldSize ?? 22) - 1)
  const driverForm = artifact.driver_priors[context.driverCode]?.historical_finish_percentile ?? 0.5
  const teamForm = artifact.team_priors[context.teamName]?.historical_finish_percentile ?? 0.5
  const driverPrior = artifact.driver_priors[context.driverCode]
  const teamPrior = artifact.team_priors[context.teamName]
  const driverQualifying = driverPrior?.historical_qualifying_percentile ?? driverForm
  const teamQualifying = teamPrior?.historical_qualifying_percentile ?? teamForm
  const driverQualifyingRecent = driverPrior?.recent_qualifying_percentile ?? driverQualifying
  const teamQualifyingRecent = teamPrior?.recent_qualifying_percentile ?? teamQualifying
  const rainfall = clamp(context.rainfall, 0, 1)
  return {
  grid_pct: gridPct,
  driver_form: driverForm,
  team_form: teamForm,
  driver_recent_form: driverPrior?.recent_finish_percentile ?? driverForm,
  team_recent_form: teamPrior?.recent_finish_percentile ?? teamForm,
  driver_quali_form: driverQualifying,
  team_quali_form: teamQualifying,
  driver_quali_recent: driverQualifyingRecent,
  team_quali_recent: teamQualifyingRecent,
  driver_quali_trend: driverPrior?.qualifying_trend ?? 0,
  team_quali_trend: teamPrior?.qualifying_trend ?? 0,
  driver_racecraft: driverPrior?.racecraft_delta ?? 0,
  team_racecraft: teamPrior?.racecraft_delta ?? 0,
  driver_experience: clamp((driverPrior?.samples ?? 0) / 20, 0, 1),
  team_experience: clamp((teamPrior?.samples ?? 0) / 40, 0, 1),
  grid_driver_gap: gridPct - driverForm,
  grid_team_gap: gridPct - teamForm,
  driver_team: driverForm * teamForm,
  form_gap: driverForm - teamForm,
  quali_team: driverQualifying * teamQualifying,
  quali_gap: driverQualifying - teamQualifying,
  rain_driver: rainfall * driverForm,
  rain_quali: rainfall * driverQualifying,
  track_lap_norm: context.track.expectedLapSeconds / 100,
  // Historical OpenF1 rows use timing-line speed traps. Fictional tracks only
  // have geometry-derived average speed, so infer the corresponding trap speed.
  speed_norm: clamp(context.track.averageSpeedKph + 90 + context.track.straightShare * 70, 250, 350) / 320,
  track_temp_norm: context.trackTemp / 40,
  rainfall,
  race_laps_norm: context.track.raceLaps / 70,
  }
}

const compoundFeatures = (compound: Compound) => ({
  soft: Number(compound === 'S'),
  medium: Number(compound === 'M'),
  hard: Number(compound === 'H'),
  intermediate: Number(compound === 'I'),
  wet: Number(compound === 'W'),
})

export const predictFinishPercentile = (context: MLContext) => (
  clamp(scalarPrediction(artifact.models.pace, contextFeatures(context)), 0, 1)
)

export const predictQualifyingPercentile = (context: MLContext) => (
  clamp(scalarPrediction(artifact.models.qualifying, contextFeatures(context)), 0, 1)
)

export const predictTyrePaceResidual = (
  context: MLContext,
  compound: Compound,
  age: number,
  raceProgress: number,
) => {
  const ageNorm = age / 40
  const progress = clamp(raceProgress, 0, 1)
  return scalarPrediction(artifact.models.tyre, {
  ...contextFeatures(context),
  ...compoundFeatures(compound),
  age_norm: ageNorm,
  age_sq: ageNorm ** 2,
  race_progress: progress,
  progress_sq: progress ** 2,
  age_temp: ageNorm * (context.trackTemp / 40),
  age_rain: ageNorm * clamp(context.rainfall, 0, 1),
  })
}

export const predictPitProbability = (
  context: MLContext,
  compound: Compound,
  age: number,
  raceProgress: number,
) => {
  const logit = scalarPrediction(artifact.models.pit_hazard, {
    ...contextFeatures(context),
    ...compoundFeatures(compound),
    age_norm: age / 40,
    race_progress: clamp(raceProgress, 0, 1),
  })
  return 1 / (1 + Math.exp(-clamp(logit, -25, 25)))
}

export const predictStartingCompoundProbabilities = (context: MLContext) => (
  softmaxPrediction(artifact.models.starting_compound, contextFeatures(context))
)

export const predictNextCompoundProbabilities = (
  context: MLContext,
  compound: Compound,
  age: number,
  raceProgress: number,
) => softmaxPrediction(artifact.models.next_compound, {
  ...contextFeatures(context),
  ...compoundFeatures(compound),
  age_norm: age / 40,
  race_progress: clamp(raceProgress, 0, 1),
})

export const predictIncidentProbability = (context: MLContext) => {
  const logit = scalarPrediction(artifact.models.incident, contextFeatures(context))
  return 1 / (1 + Math.exp(-clamp(logit, -25, 25)))
}

export const predictOvertakesPerLap = (context: MLContext) => (
  clamp(
    scalarPrediction(artifact.models.overtake_rate, contextFeatures(context))
      * clamp(0.2 + artifact.evaluation.overtake_rate.r2, 0.12, 0.85)
      + artifact.models.overtake_rate.intercept
      * (1 - clamp(0.2 + artifact.evaluation.overtake_rate.r2, 0.12, 0.85)),
    0,
    12,
  )
)

export const getLearnedDriverPrior = (code: string) => artifact.driver_priors[code]
export const getLearnedTeamPrior = (teamName: string) => artifact.team_priors[teamName]

export const mlModelSummary = {
  schemaVersion: artifact.schema_version,
  version: artifact.model_version,
  trainedAt: artifact.trained_at,
  seed: artifact.seed,
  method: artifact.method,
  data: artifact.data,
  evaluation: artifact.evaluation,
  limitations: artifact.limitations,
}
