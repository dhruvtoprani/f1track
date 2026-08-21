import type { Compound } from '../types'

const names: Record<Compound, string> = { S: 'Soft', M: 'Medium', H: 'Hard', I: 'Intermediate', W: 'Wet' }

export function CompoundBadge({ compound, age, verbose = false }: { compound: Compound; age?: number; verbose?: boolean }) {
  return <span className={`compound compound-${compound}`} title={names[compound]}><i />{verbose ? names[compound] : compound}{age !== undefined ? ` · ${age}L` : ''}</span>
}
