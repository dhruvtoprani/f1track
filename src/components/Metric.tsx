type Props = {
  label: string
  value: string
  detail?: string
  progress?: number
  tone?: 'default' | 'accent' | 'warning'
}

export function Metric({ label, value, detail, progress, tone = 'default' }: Props) {
  return (
    <div className={`metric-card tone-${tone}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
      {progress !== undefined && <div className="metric-bar"><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>}
    </div>
  )
}
