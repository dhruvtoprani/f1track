export class SeededRandom {
  private state: number
  private spare: number | null = null

  constructor(seed: number) {
    this.state = seed >>> 0 || 1
  }

  next(): number {
    this.state += 0x6d2b79f5
    let value = this.state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }

  between(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  integer(min: number, max: number): number {
    return Math.floor(this.between(min, max + 1))
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }

  normal(mean = 0, standardDeviation = 1): number {
    if (this.spare !== null) {
      const spare = this.spare
      this.spare = null
      return mean + spare * standardDeviation
    }
    let u = 0
    let v = 0
    while (u === 0) u = this.next()
    while (v === 0) v = this.next()
    const magnitude = Math.sqrt(-2 * Math.log(u))
    this.spare = magnitude * Math.sin(2 * Math.PI * v)
    return mean + magnitude * Math.cos(2 * Math.PI * v) * standardDeviation
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length)]
  }
}

export const hashSeed = (value: string): number => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
