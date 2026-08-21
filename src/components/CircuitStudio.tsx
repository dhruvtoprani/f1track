import { Activity, ArrowRight, CloudRain, Download, Gauge, Play, RefreshCw, Save, Sparkles, Upload, Wind } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import { circuitPresets } from '../data/presets'
import type { CircuitDraft, TrackAnalysis, WeatherMode } from '../types'
import { CircuitMap, type EditorMode } from './CircuitMap'
import { Metric } from './Metric'

type Props = {
  circuit: CircuitDraft
  track: TrackAnalysis
  weather: WeatherMode
  monteCarloRuns: number
  onCircuitChange: (circuit: CircuitDraft) => void
  onWeatherChange: (weather: WeatherMode) => void
  onRunsChange: (runs: number) => void
  onSimulate: () => void
  onSave: () => void
  onImport: (file: File) => void
  isRunning: boolean
  progress: number
}

const meter = (value: number) => `${Math.round(value)}/100`

export function CircuitStudio({
  circuit, track, weather, monteCarloRuns, onCircuitChange, onWeatherChange,
  onRunsChange, onSimulate, onSave, onImport, isRunning, progress,
}: Props) {
  const [mode, setMode] = useState<EditorMode>('draw')
  const fileInput = useRef<HTMLInputElement>(null)

  const loadPreset = (id: string) => {
    const preset = circuitPresets.find((item) => item.id === id)
    if (preset) onCircuitChange({ ...preset, points: preset.points.map((point) => ({ ...point })), updatedAt: new Date().toISOString() })
  }

  const reverseDirection = () => onCircuitChange({
    ...circuit,
    direction: circuit.direction === 'clockwise' ? 'counterclockwise' : 'clockwise',
    updatedAt: new Date().toISOString(),
  })

  return (
    <main className="studio-page">
      <section className="studio-intro">
        <div>
          <span className="eyebrow"><Sparkles size={14} /> Track-conditioned race intelligence</span>
          <h1>Draw the circuit.<br /><em>Forecast the field.</em></h1>
        </div>
        <p>Author a circuit with one gesture. The engine infers its physics, builds a 2026 qualifying grid, then runs 10,000 independent race outcomes to estimate each driver's win probability.</p>
      </section>

      <section className="studio-grid">
        <aside className="control-panel panel-left">
          <div className="panel-heading"><span>01</span><div><small>Circuit definition</small><h2>{circuit.name}</h2></div></div>
          <label className="field-label" htmlFor="circuit-name">Circuit name</label>
          <input id="circuit-name" value={circuit.name} onChange={(event) => onCircuitChange({ ...circuit, name: event.target.value, updatedAt: new Date().toISOString() })} />

          <label className="field-label" htmlFor="preset">Starting geometry</label>
          <select id="preset" value={circuitPresets.some((item) => item.id === circuit.id) ? circuit.id : ''} onChange={(event) => loadPreset(event.target.value)}>
            <option value="" disabled>Custom circuit</option>
            {circuitPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>

          <div className="range-header"><label htmlFor="length">Physical length</label><strong>{(circuit.lengthM / 1000).toFixed(2)} km</strong></div>
          <input id="length" type="range" min="3000" max="8000" step="10" value={circuit.lengthM} onChange={(event) => onCircuitChange({ ...circuit, lengthM: Number(event.target.value), updatedAt: new Date().toISOString() })} />
          <div className="range-labels"><span>3.0 km</span><span>8.0 km</span></div>

          <div className="direction-control">
            <div><small>Race direction</small><strong>{circuit.direction === 'clockwise' ? 'Clockwise' : 'Counter-clockwise'}</strong></div>
            <button className="icon-button" onClick={reverseDirection} aria-label="Reverse race direction"><RefreshCw size={17} /></button>
          </div>

          <div className="marker-summary">
            <span><i className="marker-swatch marker-start" /> Start / finish <b>{Math.round(circuit.startFinishFraction * 100)}%</b></span>
            <span><i className="marker-swatch marker-in" /> Pit entry <b>{Math.round(circuit.pitEntryFraction * 100)}%</b></span>
            <span><i className="marker-swatch marker-out" /> Pit exit <b>{Math.round(circuit.pitExitFraction * 100)}%</b></span>
          </div>
          <p className="panel-help">Choose a marker tool above the canvas, then click the racing line to place it.</p>

          <div className="panel-actions">
            <button className="secondary-button" onClick={onSave}><Save size={15} /> Save locally</button>
            <button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={15} /> Import</button>
            <input ref={fileInput} hidden type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && onImport(event.target.files[0])} />
          </div>
        </aside>

        <div className="canvas-panel">
          <CircuitMap circuit={circuit} track={track} editable mode={mode} onModeChange={setMode} onChange={onCircuitChange} />
          {!track.valid && (
            <div className="validation-banner" role="alert"><strong>Circuit needs attention</strong>{track.issues.join(' ')}</div>
          )}
          <div className="canvas-instruction"><span className="keycap">DRAG</span> Draw a new closed loop <ArrowRight size={13} /> <span className="mode-name">{mode.replace('-', ' ')} mode</span></div>
        </div>

        <aside className="control-panel intelligence-panel">
          <div className="panel-heading"><span>02</span><div><small>Live interpretation</small><h2>Track intelligence</h2></div></div>
          <div className="core-metrics">
            <Metric label="Inferred turns" value={String(track.cornerCount)} detail={`${Math.round(track.lowSpeedShare * 100)}% low-speed load`} />
            <Metric label="Average speed" value={`${Math.round(track.averageSpeedKph)}`} detail="km/h estimated" tone="accent" />
            <Metric label="Longest straight" value={`${Math.round(track.longestStraightM)}`} detail="metres" />
            <Metric label="Expected lap" value={`${Math.floor(track.expectedLapSeconds / 60)}:${(track.expectedLapSeconds % 60).toFixed(1).padStart(4, '0')}`} detail={`${track.raceLaps} race laps`} />
          </div>

          <div className="character-chips">{track.character.map((item) => <span key={item}>{item}</span>)}</div>

          <div className="telemetry-meters">
            <div><span>Downforce demand <b>{meter(track.downforceDemand)}</b></span><i><em style={{ width: `${track.downforceDemand}%` }} /></i></div>
            <div><span>Power sensitivity <b>{meter(track.powerSensitivity)}</b></span><i><em style={{ width: `${track.powerSensitivity}%` }} /></i></div>
            <div><span>Tyre stress <b>{meter(track.tyreStress)}</b></span><i><em style={{ width: `${track.tyreStress}%` }} /></i></div>
            <div><span>Passing difficulty <b>{meter(track.overtakingDifficulty)}</b></span><i><em style={{ width: `${track.overtakingDifficulty}%` }} /></i></div>
          </div>

          <div className="similarity-block">
            <small>Closest learned behavior</small>
            {track.similarities.map((item, index) => (
              <div key={item.name}><b>0{index + 1}</b><span><strong>{item.name}</strong><small>{item.profile}</small></span><em>{Math.round(item.score * 100)}%</em></div>
            ))}
          </div>

          <div className="model-confidence"><Activity size={17} /><div><small>Geometry confidence</small><strong>{Math.round((1 - track.oodScore) * 100)}% · {track.oodScore < 0.2 ? 'in distribution' : 'novel layout'}</strong></div></div>
        </aside>
      </section>

      <section className="launch-strip">
        <div className="launch-settings">
          <div>
            <span className="launch-label"><CloudRain size={15} /> Weather model</span>
            <div className="segmented-control">
              {(['dry', 'wet', 'dynamic'] as WeatherMode[]).map((item) => <button key={item} className={weather === item ? 'is-active' : ''} onClick={() => onWeatherChange(item)}>{item}</button>)}
            </div>
          </div>
          <div>
            <span className="launch-label"><Gauge size={15} /> Forecast sample</span>
            <select value={monteCarloRuns} onChange={(event) => onRunsChange(Number(event.target.value))} aria-label="Monte Carlo simulations">
              <option value={250}>250 runs</option><option value={1000}>1,000 runs</option><option value={5000}>5,000 runs</option><option value={10000}>10,000 runs</option>
            </select>
          </div>
          <div className="launch-facts"><span><Wind size={15} /> {track.passingZones.length} passing zones</span><span><Download size={15} /> Exportable telemetry</span></div>
        </div>
        <button className="simulate-button" onClick={onSimulate} disabled={!track.valid || isRunning}>
          {isRunning ? <><i style={{ '--progress': `${progress * 360}deg` } as CSSProperties} /> Simulating {Math.round(progress * 100)}%</> : <><Play size={19} fill="currentColor" /> Run {monteCarloRuns.toLocaleString()} forecasts <span>→</span></>}
        </button>
      </section>
    </main>
  )
}
