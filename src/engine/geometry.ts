import type { CircuitDraft, Point, TrackAnalysis, TrackSimilarity, TrackZone } from '../types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

export const ensureClosed = (points: Point[]): Point[] => {
  if (points.length < 2) return [...points]
  return distance(points[0], points[points.length - 1]) < 1
    ? [...points.slice(0, -1), { ...points[0] }]
    : [...points, { ...points[0] }]
}

export const smoothClosedPath = (input: Point[], iterations = 2): Point[] => {
  let points = ensureClosed(input).slice(0, -1)
  if (points.length < 4) return ensureClosed(points)
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next: Point[] = []
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    points = next
  }
  return ensureClosed(points)
}

const orientation = (a: Point, b: Point, c: Point) => Math.sign(cross(a, b, c))

const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  return o1 !== o2 && o3 !== o4
}

export const hasSelfIntersection = (input: Point[]): boolean => {
  const points = ensureClosed(input)
  const count = points.length - 1
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 2; j < count; j += 1) {
      if (i === 0 && j === count - 1) continue
      if (segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) return true
    }
  }
  return false
}

export const resampleClosedPath = (input: Point[], count = 360): Point[] => {
  const points = ensureClosed(input)
  if (points.length < 3) return points
  const lengths: number[] = [0]
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]))
  const total = lengths[lengths.length - 1]
  const result: Point[] = []
  let segment = 1
  for (let i = 0; i < count; i += 1) {
    const target = (i / count) * total
    while (segment < lengths.length - 1 && lengths[segment] < target) segment += 1
    const before = lengths[segment - 1]
    const span = Math.max(0.0001, lengths[segment] - before)
    const t = (target - before) / span
    result.push({
      x: points[segment - 1].x + (points[segment].x - points[segment - 1].x) * t,
      y: points[segment - 1].y + (points[segment].y - points[segment - 1].y) * t,
    })
  }
  return result
}

export const rotatePoints = (points: Point[], fraction: number, reverse = false): Point[] => {
  if (!points.length) return points
  const source = reverse ? [...points].reverse() : [...points]
  const index = Math.round(clamp(fraction, 0, 0.9999) * source.length)
  return [...source.slice(index), ...source.slice(0, index)]
}

export const calculateCurvatures = (points: Point[]): number[] => {
  const n = points.length
  if (n < 3) return points.map(() => 0)
  return points.map((point, index) => {
    const previous = points[(index - 1 + n) % n]
    const next = points[(index + 1) % n]
    const a = distance(previous, point)
    const b = distance(point, next)
    const c = distance(previous, next)
    const denominator = Math.max(0.00001, a * b * c)
    return (2 * cross(previous, point, next)) / denominator
  })
}

const countCornerGroups = (values: number[], threshold: number): number => {
  const active = values.map((value) => Math.abs(value) > threshold)
  let groups = 0
  for (let i = 0; i < active.length; i += 1) {
    if (active[i] && !active[(i - 1 + active.length) % active.length]) groups += 1
  }
  return groups
}

const circularMovingAverage = (values: number[], radius: number): number[] => values.map((_, index) => {
  let sum = 0
  let weight = 0
  for (let offset = -radius; offset <= radius; offset += 1) {
    const triangularWeight = radius + 1 - Math.abs(offset)
    sum += values[(index + offset + values.length) % values.length] * triangularWeight
    weight += triangularWeight
  }
  return sum / weight
})

const countSeparatedApexes = (values: number[], threshold: number, minimumDistance: number): number => {
  const candidates = values
    .map((value, index) => ({ value: Math.abs(value), index }))
    .filter((candidate) => {
      if (candidate.value < threshold) return false
      for (let offset = 1; offset <= 3; offset += 1) {
        if (Math.abs(values[(candidate.index - offset + values.length) % values.length]) > candidate.value) return false
        if (Math.abs(values[(candidate.index + offset) % values.length]) > candidate.value) return false
      }
      return true
    })
    .sort((a, b) => b.value - a.value)
  const selected: number[] = []
  for (const candidate of candidates) {
    const farEnough = selected.every((index) => {
      const direct = Math.abs(index - candidate.index)
      return Math.min(direct, values.length - direct) >= minimumDistance
    })
    if (farEnough) selected.push(candidate.index)
  }
  return selected.length
}

const maxCircularRun = (flags: boolean[]): number => {
  let best = 0
  let current = 0
  for (let i = 0; i < flags.length * 2; i += 1) {
    if (flags[i % flags.length]) {
      current += 1
      best = Math.max(best, Math.min(current, flags.length))
    } else current = 0
  }
  return best
}

const referenceTracks = [
  { name: 'Monza', profile: 'Power-sensitive / low downforce', vector: [0.79, 0.23, 0.24, 0.89, 0.82] },
  { name: 'Monaco', profile: 'Low-speed / track position', vector: [0.22, 0.93, 0.88, 0.16, 0.17] },
  { name: 'Silverstone', profile: 'High-speed / aero load', vector: [0.55, 0.33, 0.9, 0.52, 0.72] },
  { name: 'Suzuka', profile: 'Flowing / technical balance', vector: [0.45, 0.55, 0.84, 0.42, 0.64] },
  { name: 'Singapore', profile: 'Traction / high tyre stress', vector: [0.26, 0.9, 0.4, 0.22, 0.27] },
  { name: 'Spa-Francorchamps', profile: 'Power / high-speed efficiency', vector: [0.66, 0.28, 0.86, 0.72, 0.77] },
]

const cosine = (a: number[], b: number[]) => {
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0)
  const normA = Math.hypot(...a)
  const normB = Math.hypot(...b)
  return dot / Math.max(0.0001, normA * normB)
}

const classifySimilarities = (vector: number[]): TrackSimilarity[] => referenceTracks
  .map((track) => ({ name: track.name, profile: track.profile, score: clamp(cosine(vector, track.vector), 0, 1) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 3)

export const pointAtFraction = (points: Point[], fraction: number): Point => {
  if (!points.length) return { x: 0, y: 0 }
  const index = Math.round(((fraction % 1 + 1) % 1) * points.length) % points.length
  return points[index]
}

export const nearestFraction = (points: Point[], target: Point): number => {
  let closest = 0
  let closestDistance = Number.POSITIVE_INFINITY
  points.forEach((point, index) => {
    const value = distance(point, target)
    if (value < closestDistance) {
      closest = index
      closestDistance = value
    }
  })
  return closest / Math.max(1, points.length)
}

export const analyzeCircuit = (circuit: CircuitDraft): TrackAnalysis => {
  const issues: string[] = []
  if (circuit.points.length < 8) issues.push('Draw at least eight points to define a circuit.')
  if (hasSelfIntersection(circuit.points)) issues.push('The planar circuit intersects itself. Redraw the crossing.')
  const smooth = smoothClosedPath(circuit.points, 2)
  const resampled = resampleClosedPath(smooth, 360)
  const ordered = rotatePoints(resampled, circuit.startFinishFraction, circuit.direction === 'counterclockwise')
  const rawCurvatures = circularMovingAverage(calculateCurvatures(ordered), 4)
  const curvatureScale = Math.max(0.0001, rawCurvatures.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, rawCurvatures.length))
  const normalizedCurvatures = circularMovingAverage(rawCurvatures.map((value) => value / curvatureScale), 3)
  const abs = normalizedCurvatures.map(Math.abs)
  const straightFlags = abs.map((value) => value < 0.58)
  const highFlags = abs.map((value) => value >= 0.58 && value < 1.18)
  const lowFlags = abs.map((value) => value >= 1.18)
  const straightShare = straightFlags.filter(Boolean).length / Math.max(1, straightFlags.length)
  const highSpeedShare = highFlags.filter(Boolean).length / Math.max(1, highFlags.length)
  const lowSpeedShare = lowFlags.filter(Boolean).length / Math.max(1, lowFlags.length)
  const cornerCount = clamp(countSeparatedApexes(normalizedCurvatures, 0.82, 9) || countCornerGroups(normalizedCurvatures, 0.82), 4, 24)
  const longestStraightM = (maxCircularRun(straightFlags) / Math.max(1, straightFlags.length)) * circuit.lengthM
  const meanCurvature = abs.reduce((sum, value) => sum + value, 0) / Math.max(1, abs.length)
  const curvatureVariance = abs.reduce((sum, value) => sum + (value - meanCurvature) ** 2, 0) / Math.max(1, abs.length)
  const brakingSeverity = clamp(36 + lowSpeedShare * 74 + curvatureVariance * 12, 18, 96)
  const downforceDemand = clamp(34 + highSpeedShare * 62 + lowSpeedShare * 24 - straightShare * 22, 20, 96)
  const powerSensitivity = clamp(28 + straightShare * 76 + longestStraightM / 45 - lowSpeedShare * 18, 18, 97)
  const tractionSensitivity = clamp(31 + lowSpeedShare * 70 + cornerCount * 0.7, 22, 97)
  const tyreStress = clamp(30 + highSpeedShare * 52 + lowSpeedShare * 30 + meanCurvature * 11, 20, 96)
  const overtakingEase = clamp(18 + straightShare * 53 + longestStraightM / 18 + brakingSeverity * 0.18, 12, 94)
  const overtakingDifficulty = 100 - overtakingEase
  const averageSpeedKph = clamp(178 + straightShare * 96 + highSpeedShare * 35 - lowSpeedShare * 72, 145, 255)
  const expectedLapSeconds = (circuit.lengthM / 1000 / averageSpeedKph) * 3600 * 1.035
  const pitArc = ((circuit.pitExitFraction - circuit.pitEntryFraction + 1) % 1) * circuit.lengthM
  const pitLossSeconds = clamp(17.2 + pitArc / 235 + (100 - averageSpeedKph / 2.7) * 0.025, 17.5, 30)
  const safetyCarLikelihood = clamp(12 + cornerCount * 1.25 + overtakingDifficulty * 0.17 + lowSpeedShare * 18, 18, 76)

  const zones: TrackZone[] = []
  let runStart: number | null = null
  for (let i = 0; i <= straightFlags.length; i += 1) {
    const active = i < straightFlags.length && straightFlags[i]
    if (active && runStart === null) runStart = i
    if ((!active || i === straightFlags.length) && runStart !== null) {
      const length = i - runStart
      const meters = (length / straightFlags.length) * circuit.lengthM
      if (meters > 230) {
        const nextCurvature = abs[i % abs.length] ?? 0
        zones.push({
          id: zones.length + 1,
          startFraction: runStart / straightFlags.length,
          endFraction: (i % straightFlags.length) / straightFlags.length,
          lengthM: meters,
          score: clamp(35 + meters / 13 + nextCurvature * 13, 0, 100),
          label: `Zone ${zones.length + 1}`,
        })
      }
      runStart = null
    }
  }
  const passingZones = zones.sort((a, b) => b.score - a.score).slice(0, 4).map((zone, index) => ({ ...zone, id: index + 1, label: `Passing zone ${index + 1}` }))
  const featureVector = [straightShare, lowSpeedShare, highSpeedShare, powerSensitivity / 100, downforceDemand / 100]
  const similarities = classifySimilarities(featureVector)
  const oodScore = clamp(1 - similarities[0].score + Math.abs(cornerCount - 16) / 80, 0.06, 0.64)
  const character = [
    downforceDemand > 70 ? 'High downforce' : downforceDemand < 42 ? 'Low downforce' : 'Balanced aero',
    powerSensitivity > 68 ? 'Power sensitive' : tractionSensitivity > 68 ? 'Traction limited' : 'Mechanical balance',
    tyreStress > 68 ? 'High tyre stress' : 'Controlled degradation',
    overtakingDifficulty > 66 ? 'Track position critical' : passingZones.length >= 2 ? 'Multiple passing zones' : 'Selective overtaking',
  ]

  return {
    valid: issues.length === 0,
    issues,
    normalizedPoints: ordered,
    curvatures: normalizedCurvatures,
    lengthM: circuit.lengthM,
    raceLaps: Math.ceil(305000 / circuit.lengthM),
    sampleCount: Math.ceil(circuit.lengthM / 2),
    cornerCount,
    longestStraightM,
    averageSpeedKph,
    expectedLapSeconds,
    brakingSeverity,
    downforceDemand,
    powerSensitivity,
    tractionSensitivity,
    tyreStress,
    overtakingDifficulty,
    safetyCarLikelihood,
    pitLossSeconds,
    highSpeedShare,
    lowSpeedShare,
    straightShare,
    oodScore,
    passingZones,
    similarities,
    character,
  }
}

export const pathData = (points: Point[]): string => {
  if (!points.length) return ''
  return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')} Z`
}
