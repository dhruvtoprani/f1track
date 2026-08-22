import {
  Activity, ArrowLeft, ArrowRight, BarChart3, CloudSun, Download, Flag,
  FlaskConical, Gauge, LockKeyhole, RotateCcw, Share2, ShieldCheck,
  SlidersHorizontal, Sparkles, Target, Timer, Trophy, TrendingUp, Waves, Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { driverById, teamById } from '../data/grid'
import type {
  CircuitDraft, GridEntry, MonteCarloEntry, MonteCarloProgress,
  RaceDriverSnapshot, SimulationPackage, TrackAnalysis, WeatherMode,
} from '../types'
import { CircuitMap } from './CircuitMap'

type Tab = 'forecast' | 'strategy' | 'model'

const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`

const strategyModeCopy = {
  balanced: { label: 'Balanced baseline', detail: 'The learned team strategy runs without an intervention.' },
  undercut: { label: 'Early undercut', detail: 'The selected team prioritizes clean air with an earlier extra stop.' },
  'tyre-save': { label: 'Tyre preservation', detail: 'The selected team favors longer stints and fewer stops.' },
  attack: { label: 'Maximum attack', detail: 'The selected team accepts more variance and incident risk for upside.' },
} as const

const copyToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Clipboard permissions vary by browser; use the selection fallback below.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

const wilsonInterval = (wins: number, runs: number): [number, number] => {
  if (runs <= 0) return [0, 0]
  const z = 1.96
  const denominator = 1 + z ** 2 / runs
  const center = (wins + z ** 2 / (2 * runs)) / denominator
  const margin = z * Math.sqrt((wins * (1 - wins) + z ** 2 / (4 * runs)) / runs) / denominator
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}

const download = (name: string, content: string, type: string) => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

type RunnerProps = {
  circuit: CircuitDraft
  track: TrackAnalysis
  grid: GridEntry[]
  weather: WeatherMode
  total: number
  progress: MonteCarloProgress | null
}

export function ForecastRunner({ circuit, track, grid, weather, total, progress }: RunnerProps) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setPhase((value) => (value + 0.026) % 1), 70)
    return () => window.clearInterval(timer)
  }, [])

  const ghostCars = useMemo<RaceDriverSnapshot[]>(() => grid.slice(0, 10).map((entry, index) => ({
    driverId: entry.driverId,
    position: entry.position,
    gapSeconds: 0,
    intervalSeconds: 0,
    compound: entry.startingCompound,
    tyreAge: 0,
    stops: 0,
    progress: (phase * (1 + index * 0.035) + index * 0.078) % 1,
    lastLapSeconds: track.expectedLapSeconds,
    bestLapSeconds: track.expectedLapSeconds,
    status: 'running',
  })), [grid, phase, track.expectedLapSeconds])
  const entries = progress?.entries ?? []
  const leader = entries[0]
  const completed = progress?.completed ?? 0
  const sampleComplete = completed >= total

  return (
    <main className="race-page forecast-page" id="main-content" tabIndex={-1}>
      <section className="forecast-command-bar">
        <div className="race-identity">
          <span className={`live-pill ${sampleComplete ? 'is-complete' : ''}`} role="status" aria-live="polite"><i /> {sampleComplete ? 'SIMULATION COMPLETE' : 'MODEL RUNNING'}</span>
          <div><small>MONTE CARLO FORECAST · {weather.toUpperCase()}</small><h1>{circuit.name}</h1></div>
        </div>
        <div className="runner-throughput"><small>THROUGHPUT</small><strong>{Math.round(progress?.racesPerSecond ?? 0).toLocaleString()} <em>races/s</em></strong></div>
      </section>

      <section className="runner-stage">
        <div className="runner-map">
          <div className="runner-map-copy">
            <span><Zap size={14} /> {sampleComplete ? 'PREPARING FORECAST' : 'BATCH VISUALIZER'}</span>
            <p>{sampleComplete ? 'All outcomes sampled. Holding the completed field in view before analysis.' : 'Cars represent accelerated sampled laps—not one claimed live race.'}</p>
          </div>
          <CircuitMap circuit={circuit} track={track} cars={ghostCars} compact />
          <div className="runner-progress-shell">
            <div><span>OUTCOMES SAMPLED</span><strong>{completed.toLocaleString()} <em>/ {total.toLocaleString()}</em></strong></div>
            <div className="runner-progress" role="progressbar" aria-label="Forecast outcomes sampled" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}><i style={{ width: `${progress?.progress ? progress.progress * 100 : 0}%` }} /></div>
            <b>{Math.round((progress?.progress ?? 0) * 100)}%</b>
          </div>
        </div>

        <aside className="live-forecast-panel">
          <div className="leaderboard-heading"><span>LIVE WIN FORECAST</span><small>updates every batch</small></div>
          <div className="live-forecast-list">
            {entries.slice(0, 10).map((entry, index) => {
              const driver = driverById.get(entry.driverId)!
              const team = teamById.get(driver.teamId)!
              return (
                <div className="live-forecast-row" key={entry.driverId}>
                  <b>{index + 1}</b><i style={{ background: team.color }} />
                  <span><strong>{driver.code}</strong><small>{driver.lastName}</small></span>
                  <em>{percent(entry.wins)}</em>
                  <div><i style={{ width: `${entry.wins * 100}%`, background: team.color }} /></div>
                </div>
              )
            })}
            {!entries.length && <div className="runner-warmup"><Activity size={20} /><span>Loading learned priors and qualifying the field…</span></div>}
          </div>
          <div className="runner-leader">
            <small>CURRENT LEADER</small>
            <strong>{leader ? driverById.get(leader.driverId)?.code : '—'}</strong>
            <span>{leader ? `${Math.round(leader.wins * completed).toLocaleString()} sampled wins` : 'Awaiting first batch'}</span>
          </div>
        </aside>
      </section>
    </main>
  )
}

type RaceControlProps = {
  simulation: SimulationPackage
  previousSimulation: SimulationPackage | null
  onBack: () => void
  onResample: () => void
}

export function RaceControl({ simulation, previousSimulation, onBack, onResample }: RaceControlProps) {
  const [tab, setTab] = useState<Tab>('forecast')
  const [shareStatus, setShareStatus] = useState('')
  const leader = simulation.monteCarlo[0]
  const runnerUp = simulation.monteCarlo[1]
  const contenders = simulation.monteCarlo.slice(0, 5)
  const winner = driverById.get(leader.driverId)!
  const winnerTeam = teamById.get(winner.teamId)!
  const runnerUpDriver = driverById.get(runnerUp.driverId)!
  const winnerGrid = simulation.grid.find((entry) => entry.driverId === winner.id)!
  const runnerUpGrid = simulation.grid.find((entry) => entry.driverId === runnerUp.driverId)!
  const [intervalLow, intervalHigh] = wilsonInterval(leader.wins, simulation.monteCarloRuns)
  const halfWidth = (intervalHigh - intervalLow) / 2
  const expectedResampleMovement = halfWidth * Math.SQRT2
  const previousLeaderEntry = previousSimulation?.monteCarlo.find((entry) => entry.driverId === leader.driverId)
  const leaderMovement = previousLeaderEntry ? leader.wins - previousLeaderEntry.wins : null
  const sampleId = simulation.seed.toString(16).toUpperCase().padStart(8, '0')
  const finishRate = 1 - leader.dnfs
  const geometryProfile = simulation.track.highSpeedShare > simulation.track.lowSpeedShare
    ? 'high-speed rhythm'
    : simulation.track.lowSpeedShare > 0.38
      ? 'low-speed traction'
      : 'balanced corner mix'
  const driverExecution = simulation.weatherMode === 'dry'
    ? (winner.skill.racecraft + winner.skill.consistency) / 2
    : (winner.skill.racecraft + winner.skill.wet) / 2
  const gridDifference = runnerUpGrid.position - winnerGrid.position
  const performanceRank = [...simulation.grid].sort((a, b) => b.paceRating - a.paceRating).findIndex((entry) => entry.driverId === winner.id) + 1
  const strategyTeam = teamById.get(simulation.strategyScenario.teamId)!
  const strategyMode = strategyModeCopy[simulation.strategyScenario.mode]
  const strategyTeamWinProbability = simulation.monteCarlo.reduce((sum, entry) => (
    driverById.get(entry.driverId)?.teamId === strategyTeam.id ? sum + entry.wins : sum
  ), 0)
  const baselineTeamWinProbability = simulation.baselineMonteCarlo?.reduce((sum, entry) => (
    driverById.get(entry.driverId)?.teamId === strategyTeam.id ? sum + entry.wins : sum
  ), 0)
  const strategyDelta = baselineTeamWinProbability === undefined ? null : strategyTeamWinProbability - baselineTeamWinProbability

  const shareForecast = async () => {
    const strategyLine = strategyDelta === null
      ? ''
      : ` ${strategyTeam.shortName}'s ${strategyMode.label.toLowerCase()} changed team win probability by ${strategyDelta >= 0 ? '+' : ''}${(strategyDelta * 100).toFixed(1)} percentage points.`
    const text = `Apex forecast: ${winner.firstName} ${winner.lastName} leads at ${percent(leader.wins)} on ${simulation.circuit.name}, winning ${Math.round(leader.wins * simulation.monteCarloRuns).toLocaleString()} of ${simulation.monteCarloRuns.toLocaleString()} modeled races. The model favors a P${winnerGrid.position} start, a ${winnerGrid.paceRating.toFixed(1)} track-conditioned package rating, and a ${percent(finishRate)} finish rate.${strategyLine}`
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Apex Race Forecast', text, url })
        setShareStatus('Shared')
      } else {
        await copyToClipboard(`${text}\n${url}`)
        setShareStatus('Copied')
      }
      window.setTimeout(() => setShareStatus(''), 2400)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      await copyToClipboard(`${text}\n${url}`)
      setShareStatus('Copied')
      window.setTimeout(() => setShareStatus(''), 2400)
    }
  }

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: Tab) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tabs: Tab[] = ['forecast', 'strategy', 'model']
    const currentIndex = tabs.indexOf(current)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    const next = tabs[nextIndex]
    setTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  const exportForecast = () => {
    const header = `rank,driver,team,win_probability,win_ci_low,win_ci_high,change_vs_previous,podium_probability,points_probability,dnf_probability,average_finish,average_stops,likely_strategy\n`
    const rows = simulation.monteCarlo.map((entry, index) => {
      const driver = driverById.get(entry.driverId)!
      const team = teamById.get(driver.teamId)!
      const [low, high] = wilsonInterval(entry.wins, simulation.monteCarloRuns)
      const strategy = Object.keys(entry.strategyShares)[0] ?? ''
      const previous = previousSimulation?.monteCarlo.find((item) => item.driverId === entry.driverId)
      return [index + 1, `${driver.firstName} ${driver.lastName}`, team.name, entry.wins, low, high, previous ? entry.wins - previous.wins : '', entry.podiums, entry.pointsFinishes, entry.dnfs, entry.averageFinish, entry.averageStops, strategy].join(',')
    }).join('\n')
    download(`${simulation.circuit.name.toLowerCase().replace(/\W+/g, '-')}-forecast.csv`, header + rows, 'text/csv')
  }

  return (
    <main className="race-page forecast-page" id="main-content" tabIndex={-1}>
      <section className="race-command-bar forecast-results-bar">
        <button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Circuit studio</button>
        <div className="race-identity"><span className="complete-pill"><ShieldCheck size={12} /> FORECAST COMPLETE</span><div><small>{simulation.monteCarloRuns.toLocaleString()} INDEPENDENT OUTCOMES · {simulation.weatherMode.toUpperCase()}</small><h1>{simulation.circuit.name}</h1></div></div>
        <div className="race-actions">
          <button className="secondary-button" onClick={shareForecast}><Share2 size={15} /> {shareStatus || 'Share'}</button>
          <button className="secondary-button" onClick={exportForecast}><Download size={15} /> Export</button>
          <button className="resample-button" onClick={onResample} title={`Keep the circuit, weather, model and qualifying grid fixed; draw ${simulation.monteCarloRuns.toLocaleString()} new race outcomes`}><RotateCcw size={15} /> Resample {simulation.monteCarloRuns.toLocaleString()}</button>
          <span className="sr-only" role="status" aria-live="polite">{shareStatus ? `Forecast ${shareStatus.toLowerCase()}` : ''}</span>
        </div>
      </section>

      <section className="forecast-hero forecast-hero-refined">
        <div className="forecast-leader-card" style={{ '--team-color': winnerTeam.color } as CSSProperties}>
          <div className="forecast-kicker"><Trophy size={16} /><span>Highest modeled win probability</span></div>
          <div className="forecast-leader-visual">
            <div className="forecast-leader-name"><strong>{winner.firstName}<br />{winner.lastName}</strong><em>{winner.code}</em><span>{winnerTeam.name}</span></div>
            <div className="probability-dial" style={{ '--probability': `${leader.wins * 360}deg` } as CSSProperties}><div><strong>{percent(leader.wins)}</strong><small>win chance</small></div></div>
          </div>
          <div className="forecast-leader-count"><strong>{Math.round(leader.wins * simulation.monteCarloRuns).toLocaleString()}</strong><span>wins in {simulation.monteCarloRuns.toLocaleString()} modeled races</span></div>
          <div className="winner-reasons" aria-labelledby="winner-reasons-title">
            <div className="winner-reasons-heading"><span><Target size={15} /> MODEL READ</span><strong id="winner-reasons-title">Why {winner.lastName} leads</strong><small>Modeled edges, not causal proof.</small></div>
            <div className="winner-reason-grid">
              <article><Flag size={15} /><span>Starting control</span><strong>P{winnerGrid.position}</strong><small>{gridDifference > 0 ? `${gridDifference} place${gridDifference === 1 ? '' : 's'} ahead of ${runnerUpDriver.code}` : `${Math.round(simulation.track.overtakingDifficulty)}/100 passing difficulty`}</small></article>
              <article><Target size={15} /><span>Track package</span><strong>#{performanceRank} field</strong><small>{winnerGrid.paceRating.toFixed(1)} rating · {geometryProfile}</small></article>
              <article><ShieldCheck size={15} /><span>Execution</span><strong>{Math.round(driverExecution)}/100</strong><small>{percent(finishRate)} modeled finish rate</small></article>
            </div>
          </div>
        </div>
        <div className="forecast-contenders-panel">
          <div className="contenders-heading"><div><small>FIELD OUTLOOK</small><h2>Top contenders</h2></div><span>{simulation.monteCarloRuns.toLocaleString()} outcomes</span></div>
          <div className="contender-list">{contenders.map((entry, index) => {
            const driver = driverById.get(entry.driverId)!
            const team = teamById.get(driver.teamId)!
            return <div className="contender-row" key={entry.driverId}>
              <b>0{index + 1}</b><i style={{ background: team.color }} />
              <span><strong>{driver.code}</strong><small>{driver.firstName} {driver.lastName}</small></span>
              <div><i style={{ width: `${Math.max(2, entry.wins / leader.wins * 100)}%`, background: team.color }} /></div>
              <em>{percent(entry.wins)}</em>
            </div>
          })}</div>
          <div className="forecast-insight-row">
            <div><small>95% RANGE</small><strong>{percent(intervalLow, 2)}–{percent(intervalHigh, 2)}</strong><span>±{(halfWidth * 100).toFixed(2)} pp this sample</span></div>
            <div><small>LEAD OVER P2</small><strong>{((leader.wins - runnerUp.wins) * 100).toFixed(1)} pp</strong><span>{driverById.get(runnerUp.driverId)?.code} · {percent(runnerUp.wins)}</span></div>
            <div><small>COMPUTE</small><strong>{simulation.durationMs.toFixed(0)} ms</strong><span>{Math.round(simulation.monteCarloRuns / Math.max(0.001, simulation.durationMs / 1000)).toLocaleString()} races/s</span></div>
          </div>
        </div>
      </section>

      <section className={`resample-explainer ${previousSimulation ? 'has-comparison' : ''}`}>
        <article><LockKeyhole size={18} /><div><small>HELD FIXED</small><strong>Same forecast question</strong><p>Circuit, weather, model weights and qualifying grid.</p></div></article>
        <ArrowRight className="resample-arrow" size={18} />
        <article><Waves size={18} /><div><small>RESAMPLED</small><strong>{simulation.monteCarloRuns.toLocaleString()} new race worlds</strong><p>Incidents, reliability, strategy, traffic and execution.</p></div></article>
        <div className="resample-precision"><CloudSun size={18} /><div><small>EXPECTED MOVEMENT</small><strong>about ±{(expectedResampleMovement * 100).toFixed(2)} pp</strong><p>95% range between two independent samples.</p></div></div>
        {leaderMovement !== null && <div className="resample-comparison"><span>CURRENT VS PRIOR</span><strong className={leaderMovement > 0 ? 'is-up' : leaderMovement < 0 ? 'is-down' : ''}>{leaderMovement >= 0 ? '+' : ''}{(leaderMovement * 100).toFixed(2)} pp</strong><small>{winner.code}'s win estimate</small></div>}
      </section>

      {strategyDelta !== null && (
        <section className="strategy-impact" aria-labelledby="strategy-impact-title">
          <div className="strategy-impact-heading"><SlidersHorizontal size={18} /><div><small>PAIRED STRATEGY EXPERIMENT</small><strong id="strategy-impact-title">{strategyTeam.name} · {strategyMode.label}</strong></div></div>
          <p>{strategyMode.detail} The baseline and intervention use the same grid and random race worlds, isolating the strategy change.</p>
          <div><span>Team win probability</span><strong>{percent(strategyTeamWinProbability)}</strong><small>baseline {percent(baselineTeamWinProbability ?? 0)}</small></div>
          <div><span>Modeled change</span><strong className={strategyDelta >= 0 ? 'is-up' : 'is-down'}>{strategyDelta >= 0 ? '+' : ''}{(strategyDelta * 100).toFixed(2)} pp</strong><small>counterfactual, not a guarantee</small></div>
        </section>
      )}

      <section className="debrief-section forecast-analysis">
        <div className="debrief-heading"><div><span className="eyebrow"><FlaskConical size={14} /> Outcome intelligence</span><h2>{simulation.monteCarloRuns.toLocaleString()}-race forecast</h2></div><div className="debrief-tabs" role="tablist" aria-label="Forecast analysis">
          <button id="tab-forecast" role="tab" aria-selected={tab === 'forecast'} aria-controls="panel-forecast" tabIndex={tab === 'forecast' ? 0 : -1} className={tab === 'forecast' ? 'is-active' : ''} onKeyDown={(event) => moveTab(event, 'forecast')} onClick={() => setTab('forecast')}><BarChart3 size={13} /> Win forecast</button>
          <button id="tab-strategy" role="tab" aria-selected={tab === 'strategy'} aria-controls="panel-strategy" tabIndex={tab === 'strategy' ? 0 : -1} className={tab === 'strategy' ? 'is-active' : ''} onKeyDown={(event) => moveTab(event, 'strategy')} onClick={() => setTab('strategy')}><Timer size={13} /> Strategy</button>
          <button id="tab-model" role="tab" aria-selected={tab === 'model'} aria-controls="panel-model" tabIndex={tab === 'model' ? 0 : -1} className={tab === 'model' ? 'is-active' : ''} onKeyDown={(event) => moveTab(event, 'model')} onClick={() => setTab('model')}><Sparkles size={13} /> Model</button>
        </div></div>

        {tab === 'forecast' && (
          <div className="forecast-board" id="panel-forecast" role="tabpanel" aria-labelledby="tab-forecast">
            <div className="forecast-table-shell">
              <table className="forecast-table">
                <caption className="sr-only">Driver forecast probabilities across {simulation.monteCarloRuns.toLocaleString()} modeled races</caption>
                <thead><tr><th>Rank</th><th>Driver</th><th>Win probability</th><th>95% interval</th>{previousSimulation && <th>Vs prior</th>}<th>Podium</th><th>Points</th><th>DNF</th><th>Avg finish</th></tr></thead>
                <tbody>{simulation.monteCarlo.map((entry, index) => {
                  const driver = driverById.get(entry.driverId)!
                  const team = teamById.get(driver.teamId)!
                  const [low, high] = wilsonInterval(entry.wins, simulation.monteCarloRuns)
                  const previous = previousSimulation?.monteCarlo.find((item) => item.driverId === entry.driverId)
                  const movement = previous ? (entry.wins - previous.wins) * 100 : null
                  return <tr key={entry.driverId}>
                    <td><b>{index + 1}</b></td>
                    <td><span className="forecast-driver"><i style={{ background: team.color }} /><strong>{driver.code}</strong><small>{driver.firstName} {driver.lastName} · {team.shortName}</small></span></td>
                    <td><span className="forecast-probability"><b>{percent(entry.wins)}</b><i><em style={{ width: `${entry.wins * 100}%`, background: team.color }} /></i></span></td>
                    <td>{percent(low, 2)}–{percent(high, 2)}</td>
                    {previousSimulation && <td><span className={`forecast-delta ${movement && movement > 0 ? 'is-up' : movement && movement < 0 ? 'is-down' : ''}`}>{movement === null ? '—' : `${movement >= 0 ? '+' : ''}${movement.toFixed(2)} pp`}</span></td>}
                    <td>{percent(entry.podiums)}</td><td>{percent(entry.pointsFinishes)}</td><td>{percent(entry.dnfs)}</td><td>P{entry.averageFinish.toFixed(1)}</td>
                  </tr>
                })}</tbody>
              </table>
            </div>
            <aside className="forecast-method-card">
              <Gauge size={25} /><small>HOW TO READ THIS</small><h3>A distribution,<br />not a promise</h3>
              <p>Each percentage is the share of modeled worlds won by that driver. “Resample” keeps the inputs fixed and draws a new set, so small movements are expected.</p>
              <div><span>Sample size</span><b>{simulation.monteCarloRuns.toLocaleString()} races</b></div>
              <div><span>Leader sampling error</span><b>±{(halfWidth * 100).toFixed(2)} pp at 95%</b></div>
              <div><span>Resample movement</span><b>about ±{(expectedResampleMovement * 100).toFixed(2)} pp</b></div>
              <div><span>Track extrapolation</span><b>{simulation.track.oodScore < 0.2 ? 'In distribution' : 'Novel geometry'}</b></div>
              <div><span>Sample ID</span><b>{sampleId}</b></div>
            </aside>
          </div>
        )}

        {tab === 'strategy' && <div className="strategy-board forecast-strategies" id="panel-strategy" role="tabpanel" aria-labelledby="tab-strategy">{simulation.monteCarlo.slice(0, 12).map((entry, index) => {
          const driver = driverById.get(entry.driverId)!
          const team = teamById.get(driver.teamId)!
          const strategies = Object.entries(entry.strategyShares)
          const likely = strategies[0]
          return <article key={entry.driverId}>
            <div><b>{index + 1}</b><span><strong>{driver.code}</strong><small>{team.shortName}</small></span><em>{likely ? percent(likely[1]) : '—'} likely</em></div>
            <div className="stint-line">{(likely?.[0] ?? '—').split('→').map((compound, compoundIndex) => <span className={`stint compound-bg-${compound}`} style={{ flex: 1 }} key={`${compound}-${compoundIndex}`}>{compound}<i /></span>)}</div>
            <p><b>{likely?.[0] ?? 'No strategy'}</b> · {entry.averageStops.toFixed(2)} mean stops · {percent(entry.pointsFinishes)} points finishes</p>
          </article>
        })}</div>}

        {tab === 'model' && <div className="model-card-layout" id="panel-model" role="tabpanel" aria-labelledby="tab-model">
          <article><ShieldCheck size={25} /><small>MODEL IDENTITY</small><h3>{simulation.calibration.modelVersion}</h3><p><b>{simulation.calibration.modelMethod}</b> combines recency weighting, robust Huber fitting, nonlinear kernel features, and a separate DNF hazard. The geometry engine conditions that learned system on the custom circuit.</p><dl><div><dt>Training source</dt><dd>{simulation.calibration.dataSource}</dd></div><div><dt>Race sessions</dt><dd>{simulation.calibration.trainingRaces}</dd></div><div><dt>Training samples</dt><dd>{simulation.calibration.trainingRows.toLocaleString()}</dd></div><div><dt>Artifact trained</dt><dd>{new Date(simulation.calibration.trainedAt).toLocaleDateString()}</dd></div><div><dt>Reproducible sample</dt><dd>{sampleId}</dd></div></dl></article>
          <article><TrendingUp size={25} /><small>NESTED TIME HOLDOUTS</small><h3>Measured accuracy</h3><p>Hyperparameters are chosen on an inner past-only split. The newest races remain untouched until final scoring, while track-level holdouts measure circuit transfer.</p><dl><div><dt>Classified-finish pace MAE</dt><dd>{simulation.calibration.holdout.paceMae.toFixed(3)}</dd></div><div><dt>Qualifying percentile MAE</dt><dd>{simulation.calibration.holdout.qualifyingMae.toFixed(3)}</dd></div><div><dt>Tyre residual MAE</dt><dd>{simulation.calibration.holdout.tyreMae.toFixed(3)} s</dd></div><div><dt>Pit decision log loss</dt><dd>{simulation.calibration.holdout.pitLogLoss.toFixed(3)}</dd></div><div><dt>Starting tyre accuracy</dt><dd>{percent(simulation.calibration.holdout.startingCompoundAccuracy)}</dd></div></dl></article>
          <article><Activity size={25} /><small>LIMITS & UNCERTAINTY</small><h3>{Math.round(simulation.calibration.confidence * 100)}% context confidence</h3><p className="model-caveat">{simulation.calibration.caveat}</p><p>The 95% intervals shown in the forecast table measure finite-simulation sampling error. They do not include every source of model misspecification, regulation change, setup choice, or future driver/team development.</p><div className="feature-cloud"><span>OpenF1 timing</span><span>Temporal Huber</span><span>Kernel features</span><span>Competing risks</span><span>Nested holdout</span><span>Track geometry</span><span>{simulation.monteCarloRuns.toLocaleString()} Monte Carlo</span></div></article>
        </div>}
      </section>
    </main>
  )
}
