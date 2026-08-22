import { Flag, LocateFixed, PenLine, RotateCcw, Route, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { CircuitDraft, Point, RaceDriverSnapshot, TrackAnalysis } from '../types'
import { driverById, teamById } from '../data/grid'
import { nearestFraction, pathData, pointAtFraction } from '../engine/geometry'

export type EditorMode = 'draw' | 'start' | 'pit-entry' | 'pit-exit'

type Props = {
  circuit: CircuitDraft
  track: TrackAnalysis
  editable?: boolean
  mode?: EditorMode
  onModeChange?: (mode: EditorMode) => void
  onChange?: (circuit: CircuitDraft) => void
  cars?: RaceDriverSnapshot[]
  compact?: boolean
}

const toCanvasPoint = (event: React.PointerEvent<SVGSVGElement>): Point => {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width) * 760,
    y: ((event.clientY - rect.top) / rect.height) * 560,
  }
}

const markerFraction = (circuit: CircuitDraft, rawFraction: number) => {
  if (circuit.direction === 'clockwise') return (rawFraction - circuit.startFinishFraction + 1) % 1
  return (circuit.startFinishFraction - rawFraction + 1) % 1
}

export function CircuitMap({ circuit, track, editable = false, mode = 'draw', onModeChange, onChange, cars, compact = false }: Props) {
  const [drawing, setDrawing] = useState(false)
  const history = useRef<Point[][]>([])
  const svgPath = useMemo(() => pathData(track.normalizedPoints), [track.normalizedPoints])
  const startPoint = track.normalizedPoints[0] ?? { x: 0, y: 0 }
  const pitEntry = pointAtFraction(track.normalizedPoints, markerFraction(circuit, circuit.pitEntryFraction))
  const pitExit = pointAtFraction(track.normalizedPoints, markerFraction(circuit, circuit.pitExitFraction))

  const updateMarker = (point: Point) => {
    if (!onChange || mode === 'draw') return
    const relative = nearestFraction(track.normalizedPoints, point)
    const raw = circuit.direction === 'clockwise'
      ? (relative + circuit.startFinishFraction) % 1
      : (circuit.startFinishFraction - relative + 1) % 1
    const patch = mode === 'start'
      ? { startFinishFraction: raw }
      : mode === 'pit-entry'
        ? { pitEntryFraction: raw }
        : { pitExitFraction: raw }
    onChange({ ...circuit, ...patch, updatedAt: new Date().toISOString() })
  }

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!editable || !onChange) return
    const point = toCanvasPoint(event)
    if (mode !== 'draw') {
      updateMarker(point)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    history.current.push(circuit.points)
    setDrawing(true)
    onChange({ ...circuit, points: [point], updatedAt: new Date().toISOString() })
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing || !onChange) return
    const point = toCanvasPoint(event)
    const previous = circuit.points[circuit.points.length - 1]
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 4) {
      onChange({ ...circuit, points: [...circuit.points, point], updatedAt: new Date().toISOString() })
    }
  }

  const finishDrawing = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing || !onChange) return
    setDrawing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (circuit.points.length > 7) onChange({ ...circuit, points: [...circuit.points, circuit.points[0]], updatedAt: new Date().toISOString() })
  }

  const undo = () => {
    const previous = history.current.pop()
    if (previous && onChange) onChange({ ...circuit, points: previous, updatedAt: new Date().toISOString() })
  }

  return (
    <div className={`circuit-map-shell ${compact ? 'is-compact' : ''}`}>
      {editable && (
        <div className="map-toolbar" role="toolbar" aria-label="Circuit drawing tools">
          <button aria-pressed={mode === 'draw'} className={mode === 'draw' ? 'is-active' : ''} onClick={() => onModeChange?.('draw')} title="Draw circuit" aria-label="Draw circuit"><PenLine size={17} /></button>
          <button aria-pressed={mode === 'start'} className={mode === 'start' ? 'is-active' : ''} onClick={() => onModeChange?.('start')} title="Place start and finish" aria-label="Place start and finish"><Flag size={17} /></button>
          <button aria-pressed={mode === 'pit-entry'} className={mode === 'pit-entry' ? 'is-active' : ''} onClick={() => onModeChange?.('pit-entry')} title="Place pit entry" aria-label="Place pit entry"><LocateFixed size={17} /></button>
          <button aria-pressed={mode === 'pit-exit'} className={mode === 'pit-exit' ? 'is-active' : ''} onClick={() => onModeChange?.('pit-exit')} title="Place pit exit" aria-label="Place pit exit"><Route size={17} /></button>
          <span className="toolbar-spacer" />
          <button onClick={undo} title="Undo drawing" aria-label="Undo drawing"><Undo2 size={17} /></button>
          <button onClick={() => onChange?.({ ...circuit, points: [], updatedAt: new Date().toISOString() })} title="Clear circuit" aria-label="Clear circuit"><Trash2 size={17} /></button>
        </div>
      )}
      <svg
        className={`circuit-map ${editable ? 'is-editable' : ''}`}
        viewBox="0 0 760 560"
        role="img"
        aria-label={editable ? 'Interactive circuit drawing canvas' : `${circuit.name} circuit map`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
      >
        <defs>
          <pattern id="minor-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,.025)" strokeWidth="1" /></pattern>
          <pattern id="major-grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#minor-grid)" /><path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(255,255,255,.045)" strokeWidth="1" /></pattern>
          <filter id="track-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width="760" height="560" fill="url(#major-grid)" />
        <g className="axis-labels" aria-hidden="true"><text x="24" y="31">N 41° 52′</text><text x="615" y="532">ELEV 012 M</text></g>
        {svgPath && <path d={svgPath} className="track-shadow" />}
        {svgPath && <path d={svgPath} className="track-surface" />}
        {svgPath && <path d={svgPath} className="track-center" filter="url(#track-glow)" />}
        {track.passingZones.map((zone) => {
          const start = pointAtFraction(track.normalizedPoints, zone.startFraction)
          const end = pointAtFraction(track.normalizedPoints, zone.endFraction)
          return <line key={zone.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} className="passing-zone" />
        })}
        {track.normalizedPoints.length > 0 && (
          <>
            <g className="marker start-marker" transform={`translate(${startPoint.x} ${startPoint.y})`}><circle r="10" /><path d="M-8-9v18M-2-9v18M4-9v18M10-9v18" /></g>
            <g className="marker pit-marker" transform={`translate(${pitEntry.x} ${pitEntry.y})`}><circle r="7" /><text y="3">IN</text></g>
            <g className="marker pit-marker" transform={`translate(${pitExit.x} ${pitExit.y})`}><circle r="7" /><text y="3">OUT</text></g>
          </>
        )}
        {cars?.map((car) => {
          const driver = driverById.get(car.driverId)!
          const team = teamById.get(driver.teamId)!
          const point = pointAtFraction(track.normalizedPoints, car.progress)
          return (
            <g key={car.driverId} className={`race-car ${car.position <= 3 ? 'is-top-three' : ''}`} transform={`translate(${point.x} ${point.y})`}>
              <circle r={car.position <= 3 ? 8 : 5.5} fill={team.color} stroke={car.position <= 3 ? '#fff' : '#101213'} strokeWidth="2" />
              {car.position <= 3 && <text x="10" y="4">{driver.code}</text>}
            </g>
          )
        })}
      </svg>
      {!compact && (
        <div className="map-footer">
          <span><i className="status-dot" /> LIVE GEOMETRY</span>
          <span>{track.sampleCount.toLocaleString()} samples · 2 m resolution</span>
          <span><RotateCcw size={13} /> {circuit.direction === 'clockwise' ? 'CW' : 'CCW'}</span>
        </div>
      )}
    </div>
  )
}
