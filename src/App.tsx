import { Database, GitBranch, Radio, Save, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CircuitStudio } from './components/CircuitStudio'
import { ForecastRunner, RaceControl } from './components/RaceControl'
import { circuitPresets } from './data/presets'
import { calibrationSnapshot } from './data/grid'
import { mlModelSummary } from './data/mlRuntime'
import { analyzeCircuit } from './engine/geometry'
import { runMonteCarlo, simulateQualifying } from './engine/simulator'
import { hashSeed } from './engine/random'
import type { CircuitDraft, GridEntry, MonteCarloProgress, SimulationPackage, WeatherMode } from './types'

const MIN_SIMULATION_DISPLAY_MS = 2800

const cloneCircuit = (circuit: CircuitDraft): CircuitDraft => ({ ...circuit, points: circuit.points.map((point) => ({ ...point })) })

const getInitialCircuit = (): CircuitDraft => {
  try {
    const saved = localStorage.getItem('apex:last-circuit')
    if (saved) return JSON.parse(saved) as CircuitDraft
  } catch {
    // Fall back to the authored default if storage is unavailable or invalid.
  }
  return cloneCircuit(circuitPresets[0])
}

export default function App() {
  const [circuit, setCircuit] = useState<CircuitDraft>(getInitialCircuit)
  const [weather, setWeather] = useState<WeatherMode>('dry')
  const [monteCarloRuns, setMonteCarloRuns] = useState(10000)
  const [simulation, setSimulation] = useState<SimulationPackage | null>(null)
  const [previousSimulation, setPreviousSimulation] = useState<SimulationPackage | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [runGrid, setRunGrid] = useState<GridEntry[]>([])
  const [runProgress, setRunProgress] = useState<MonteCarloProgress | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const track = useMemo(() => analyzeCircuit(circuit), [circuit])

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2800)
  }

  const saveCircuit = () => {
    localStorage.setItem('apex:last-circuit', JSON.stringify(circuit))
    const library = JSON.parse(localStorage.getItem('apex:circuit-library') ?? '[]') as CircuitDraft[]
    const next = [circuit, ...library.filter((item) => item.id !== circuit.id)].slice(0, 12)
    localStorage.setItem('apex:circuit-library', JSON.stringify(next))
    showToast('Circuit saved to this browser')
  }

  const importCircuit = async (file: File) => {
    try {
      const value = JSON.parse(await file.text()) as CircuitDraft
      if (!value.name || !Array.isArray(value.points) || value.points.length < 8 || typeof value.lengthM !== 'number') throw new Error('Invalid circuit')
      setCircuit({ ...value, id: value.id || `import-${Date.now()}`, updatedAt: new Date().toISOString() })
      showToast('Circuit imported')
    } catch {
      showToast('That file is not a valid Apex circuit')
    }
  }

  const simulate = async (resample = false) => {
    if (!track.valid || isRunning) return
    const visualStartedAt = performance.now()
    const priorSimulation = simulation
    setPreviousSimulation(resample ? priorSimulation : null)
    setIsRunning(true)
    setProgress(0)
    setRunProgress(null)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
    const qualifyingSeed = hashSeed(`${circuit.id}:${circuit.updatedAt.slice(0, 10)}:${weather}:qualifying`)
    const monteCarloSeed = resample
      ? window.crypto.getRandomValues(new Uint32Array(1))[0]
      : hashSeed(`${circuit.id}:${circuit.updatedAt.slice(0, 10)}:${weather}:forecast`)
    // A resample must answer the same question with a fresh random draw. Keep
    // circuit, weather, model and qualifying grid fixed; vary race worlds only.
    const grid = resample && priorSimulation
      ? priorSimulation.grid
      : simulateQualifying(circuit, track, weather, qualifyingSeed)
    setRunGrid(grid)
    const startedAt = performance.now()
    const monteCarlo = await runMonteCarlo(circuit, track, grid, weather, monteCarloRuns, (value) => {
      setProgress(value.progress)
      setRunProgress(value)
    }, monteCarloSeed)
    const payload: SimulationPackage = {
      id: `sim-${Date.now()}`,
      createdAt: new Date().toISOString(),
      circuit,
      track,
      weatherMode: weather,
      grid,
      seed: monteCarloSeed,
      durationMs: performance.now() - startedAt,
      monteCarloRuns,
      monteCarlo,
      calibration: {
        season: calibrationSnapshot.season,
        modelVersion: mlModelSummary.version,
        modelMethod: mlModelSummary.method.short_name,
        confidence: Math.max(0.38, Math.min(0.94,
          (1 - track.oodScore * 0.82) * 0.68
          + (1 - mlModelSummary.evaluation.pace.mae) * 0.18
          + (1 - mlModelSummary.evaluation.pit.log_loss) * 0.14,
        )),
        caveat: 'Models are trained on public historical timing data; fictional-track extrapolation and unavailable setup/fuel inputs remain uncertainty sources.',
        dataSource: `${mlModelSummary.data.source} ${mlModelSummary.data.seasons[0]}–${mlModelSummary.data.seasons.at(-1)}`,
        trainedAt: mlModelSummary.trainedAt,
        trainingRaces: mlModelSummary.data.races,
        trainingRows: mlModelSummary.data.tyre_rows + mlModelSummary.data.pace_rows + mlModelSummary.data.qualifying_rows + mlModelSummary.data.pit_rows + mlModelSummary.data.start_rows + mlModelSummary.data.next_compound_rows,
        holdout: {
          paceMae: mlModelSummary.evaluation.pace.mae,
          qualifyingMae: mlModelSummary.evaluation.qualifying.mae,
          tyreMae: mlModelSummary.evaluation.tyre.mae,
          pitLogLoss: mlModelSummary.evaluation.pit.log_loss,
          startingCompoundAccuracy: mlModelSummary.evaluation.starting_compound.accuracy,
        },
      },
    }
    const remainingDisplayMs = Math.max(0, MIN_SIMULATION_DISPLAY_MS - (performance.now() - visualStartedAt))
    if (remainingDisplayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, remainingDisplayMs))
    }
    setSimulation(payload)
    setProgress(1)
    setIsRunning(false)
    localStorage.setItem('apex:last-circuit', JSON.stringify(circuit))
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => { setSimulation(null); setPreviousSimulation(null) }} aria-label="Apex home"><span className="brand-mark"><i /><i /><i /></span><span><strong>APEX</strong><small>RACE FORECAST LAB</small></span></button>
        <nav aria-label="Project stages">
          <span className={!simulation && !isRunning ? 'is-active' : 'is-complete'}><b>01</b> Circuit</span>
          <i />
          <span className={!simulation && !isRunning ? '' : 'is-complete'}><b>02</b> Intelligence</span>
          <i />
          <span className={simulation || isRunning ? 'is-active' : ''}><b>03</b> Forecast</span>
          <i />
          <span className={simulation ? 'is-active' : ''}><b>04</b> Analysis</span>
        </nav>
        <div className="header-status"><span><Radio size={13} /> 2026 GRID</span><span><Database size={13} /> ML {mlModelSummary.version.slice(-10)}</span><span aria-label="Local project"><GitBranch size={16} /></span></div>
      </header>

      {isRunning ? (
        <ForecastRunner circuit={circuit} track={track} grid={runGrid} weather={weather} total={monteCarloRuns} progress={runProgress} />
      ) : simulation ? (
        <RaceControl
          simulation={simulation}
          previousSimulation={previousSimulation}
          onBack={() => { setSimulation(null); setPreviousSimulation(null) }}
          onResample={() => simulate(true)}
        />
      ) : (
        <CircuitStudio
          circuit={circuit}
          track={track}
          weather={weather}
          monteCarloRuns={monteCarloRuns}
          onCircuitChange={setCircuit}
          onWeatherChange={setWeather}
          onRunsChange={setMonteCarloRuns}
          onSimulate={() => simulate(false)}
          onSave={saveCircuit}
          onImport={importCircuit}
          isRunning={isRunning}
          progress={progress}
        />
      )}

      <footer className="app-footer"><span><ShieldCheck size={14} /> Real-data ML · reproducible OpenF1 training</span><span>Geometry → Learned performance → Strategy → 10,000 outcomes</span><button onClick={saveCircuit}><Save size={13} /> Save state</button></footer>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
