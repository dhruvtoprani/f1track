import { Download, Share2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { driverById, teamById } from '../data/grid'
import type { Point, SimulationPackage, StrategyMode } from '../types'

const CARD_WIDTH = 1200
const CARD_HEIGHT = 630
const PRODUCT_URL = 'https://apex-race-lab.vercel.app'

const strategyLabels: Record<StrategyMode, string> = {
  balanced: 'Balanced baseline',
  undercut: 'Early undercut',
  'tyre-save': 'Tyre preservation',
  attack: 'Maximum attack',
}

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

const truncate = (value: string, length: number) => value.length > length
  ? `${value.slice(0, Math.max(1, length - 1))}…`
  : value

const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`

const safeColor = (value: string) => /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#ff3d24'

const fittedTrackPath = (points: Point[]) => {
  if (points.length < 2) return ''
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const scale = Math.min(438 / width, 300 / height)
  const offsetX = 680 + (438 - width * scale) / 2
  const offsetY = 142 + (300 - height * scale) / 2
  return points.map((point, index) => {
    const x = offsetX + (point.x - minX) * scale
    const y = offsetY + (point.y - minY) * scale
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ') + ' Z'
}

const strategyTeamProbability = (simulation: SimulationPackage, baseline = false) => {
  const entries = baseline ? simulation.baselineMonteCarlo : simulation.monteCarlo
  if (!entries) return null
  return entries.reduce((sum, entry) => (
    driverById.get(entry.driverId)?.teamId === simulation.strategyScenario.teamId ? sum + entry.wins : sum
  ), 0)
}

export const createForecastCardSvg = (simulation: SimulationPackage) => {
  const leader = simulation.monteCarlo[0]
  const winner = driverById.get(leader.driverId)!
  const winnerTeam = teamById.get(winner.teamId)!
  const winnerGrid = simulation.grid.find((entry) => entry.driverId === winner.id)!
  const performanceRank = [...simulation.grid]
    .sort((a, b) => b.paceRating - a.paceRating)
    .findIndex((entry) => entry.driverId === winner.id) + 1
  const winnerColor = safeColor(winnerTeam.color)
  const trackPath = fittedTrackPath(simulation.track.normalizedPoints)
  const topThree = simulation.monteCarlo.slice(0, 3).map((entry) => {
    const driver = driverById.get(entry.driverId)!
    return { code: driver.code, probability: entry.wins, color: safeColor(teamById.get(driver.teamId)!.color) }
  })
  const sampleId = simulation.seed.toString(16).toUpperCase().padStart(8, '0')
  const strategyTeam = teamById.get(simulation.strategyScenario.teamId)!
  const scenarioProbability = strategyTeamProbability(simulation) ?? 0
  const baselineProbability = strategyTeamProbability(simulation, true)
  const strategyDelta = baselineProbability === null ? null : scenarioProbability - baselineProbability
  const strategyLine = strategyDelta === null
    ? 'BALANCED STRATEGY · NO INTERVENTION'
    : `${strategyTeam.shortName.toUpperCase()} · ${strategyLabels[simulation.strategyScenario.mode].toUpperCase()} · ${strategyDelta >= 0 ? '+' : ''}${(strategyDelta * 100).toFixed(2)} PP TEAM WIN CHANCE`
  const circuitName = escapeXml(truncate(simulation.circuit.name.toUpperCase(), 31))
  const winnerName = escapeXml(truncate(winner.lastName.toUpperCase(), 16))
  const reasonLine = `P${winnerGrid.position} START · #${performanceRank} TRACK PACKAGE · ${percent(1 - leader.dnfs)} FINISH RATE`
  const topThreeMarkup = topThree.map((entry, index) => {
    const x = 60 + index * 176
    return `<g transform="translate(${x} 526)">
      <rect width="158" height="48" fill="#111516" stroke="#2a2f31"/>
      <rect width="4" height="48" fill="${entry.color}"/>
      <text x="17" y="19" class="micro">0${index + 1}</text>
      <text x="17" y="38" class="rank">${escapeXml(entry.code)}</text>
      <text x="143" y="35" text-anchor="end" class="rank">${percent(entry.probability)}</text>
    </g>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-labelledby="title description">
    <title id="title">${circuitName} Apex race forecast card</title>
    <desc id="description">The authored circuit and forecast result led by ${winnerName} at ${percent(leader.wins)}.</desc>
    <defs>
      <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#202426" stroke-width="1" opacity=".35"/></pattern>
      <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <style>
        .sans{font-family:Arial,Helvetica,sans-serif}.mono{font-family:"Courier New",monospace}.micro{font:700 11px "Courier New",monospace;letter-spacing:1.4px;fill:#8f9699}.rank{font:700 18px Arial,Helvetica,sans-serif;fill:#f3f5f5}.label{font:700 12px "Courier New",monospace;letter-spacing:2px;fill:#a5abad}.body{font:500 15px Arial,Helvetica,sans-serif;fill:#b9bec0}
      </style>
    </defs>
    <rect width="1200" height="630" fill="#080a0b"/>
    <rect x="620" width="580" height="630" fill="url(#grid)"/>
    <circle cx="1080" cy="70" r="230" fill="${winnerColor}" opacity=".055"/>
    <rect x="0" y="0" width="9" height="630" fill="#ff3d24"/>
    <text x="60" y="57" class="sans" font-size="25" font-weight="800" font-style="italic" letter-spacing="5" fill="#f3f5f5">APEX</text>
    <text x="177" y="56" class="mono" font-size="11" letter-spacing="2" fill="#ff6b55">RACE FORECAST CARD</text>
    <text x="1140" y="56" text-anchor="end" class="mono" font-size="11" letter-spacing="1.5" fill="#8f9699">TRACK-CONDITIONED · 2026 GRID</text>
    <line x1="60" y1="88" x2="1140" y2="88" stroke="#2a2f31"/>

    <text x="60" y="132" class="label">AUTHORED CIRCUIT</text>
    <text x="60" y="177" class="sans" font-size="37" font-weight="800" letter-spacing="-1" fill="#f3f5f5">${circuitName}</text>
    <text x="60" y="209" class="mono" font-size="13" fill="#9ba2a5">${(simulation.circuit.lengthM / 1000).toFixed(2)} KM · ${simulation.track.raceLaps} LAPS · ${simulation.weatherMode.toUpperCase()} · ${simulation.monteCarloRuns.toLocaleString()} WORLDS</text>

    <text x="60" y="263" class="label">HIGHEST MODELED WIN PROBABILITY</text>
    <text x="60" y="332" class="sans" font-size="70" font-weight="800" letter-spacing="-3" fill="#f3f5f5">${winnerName}</text>
    <text x="60" y="365" class="mono" font-size="14" font-weight="700" letter-spacing="2" fill="${winnerColor}">${escapeXml(winner.code)} · ${escapeXml(winnerTeam.name.toUpperCase())}</text>
    <text x="60" y="397" class="mono" font-size="12" fill="#929a9d">${reasonLine}</text>

    <rect x="60" y="420" width="190" height="80" fill="#111516" stroke="#2a2f31"/>
    <text x="78" y="445" class="micro">WIN CHANCE</text>
    <text x="78" y="483" class="sans" font-size="39" font-weight="800" fill="${winnerColor}">${percent(leader.wins)}</text>
    <rect x="266" y="420" width="266" height="80" fill="#111516" stroke="#2a2f31"/>
    <text x="284" y="445" class="micro">MODELED WINS</text>
    <text x="284" y="483" class="sans" font-size="34" font-weight="800" fill="#f3f5f5">${Math.round(leader.wins * simulation.monteCarloRuns).toLocaleString()} <tspan font-size="15" fill="#969da0">/ ${simulation.monteCarloRuns.toLocaleString()}</tspan></text>
    ${topThreeMarkup}

    <text x="650" y="126" class="label">YOUR TRACK</text>
    <rect x="650" y="142" width="490" height="318" fill="#0b0e0f" stroke="#2a2f31"/>
    ${trackPath ? `<path d="${trackPath}" fill="none" stroke="#000" stroke-width="25" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/><path d="${trackPath}" fill="none" stroke="#2f3537" stroke-width="17" stroke-linejoin="round" stroke-linecap="round"/><path d="${trackPath}" fill="none" stroke="${winnerColor}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6 8" filter="url(#glow)"/>` : ''}
    <circle cx="${trackPath ? fittedStartPoint(simulation.track.normalizedPoints).x : 0}" cy="${trackPath ? fittedStartPoint(simulation.track.normalizedPoints).y : 0}" r="8" fill="#080a0b" stroke="#ff3d24" stroke-width="3"/>
    <text x="670" y="447" class="mono" font-size="10" fill="#737b7e">${simulation.track.cornerCount} TURNS · ${Math.round(simulation.track.averageSpeedKph)} KM/H AVG · ${Math.round(simulation.track.longestStraightM)} M STRAIGHT</text>

    <rect x="650" y="480" width="490" height="72" fill="#101415" stroke="#2a2f31"/>
    <text x="670" y="505" class="micro">STRATEGY SCENARIO</text>
    <text x="670" y="535" class="mono" font-size="13" font-weight="700" fill="${strategyDelta !== null && strategyDelta >= 0 ? '#caff36' : '#d8dcde'}">${escapeXml(strategyLine)}</text>

    <line x1="650" y1="578" x2="1140" y2="578" stroke="#2a2f31"/>
    <text x="650" y="608" class="mono" font-size="11" fill="#caff36">APEX-RACE-LAB.VERCEL.APP</text>
    <text x="1140" y="608" text-anchor="end" class="mono" font-size="10" fill="#737b7e">SAMPLE ${sampleId} · MODELED OUTCOME, NOT A PROMISE</text>
  </svg>`
}

const fittedStartPoint = (points: Point[]) => {
  if (!points.length) return { x: 0, y: 0 }
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const scale = Math.min(438 / width, 300 / height)
  return {
    x: 680 + (438 - width * scale) / 2 + (points[0].x - minX) * scale,
    y: 142 + (300 - height * scale) / 2 + (points[0].y - minY) * scale,
  }
}

const svgToPng = async (svg: string) => {
  const source = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(source)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = CARD_WIDTH
    canvas.height = CARD_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas rendering is unavailable in this browser.')
    context.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The forecast card could not be encoded.'))
    }, 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const copyCaption = async (caption: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(caption)
      return true
    } catch {
      // Clipboard permissions vary; use the selection fallback below.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = caption
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

type Props = {
  simulation: SimulationPackage
  onClose: () => void
}

export function ForecastShareCard({ simulation, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const svg = useMemo(() => createForecastCardSvg(simulation), [simulation])
  const previewUrl = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg])
  const leader = simulation.monteCarlo[0]
  const winner = driverById.get(leader.driverId)!
  const slug = simulation.circuit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'apex-track'
  const filename = `${slug}-forecast.png`
  const caption = `I drew ${simulation.circuit.name} in Apex. ${winner.firstName} ${winner.lastName} leads the ${simulation.monteCarloRuns.toLocaleString()}-race forecast at ${percent(leader.wins)}. ${PRODUCT_URL}`

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const close = () => dialogRef.current?.close()

  const handleDownload = async () => {
    setBusy(true)
    setStatus('Rendering card…')
    try {
      const blob = await svgToPng(svg)
      downloadBlob(blob, filename)
      setStatus('PNG downloaded')
    } catch {
      setStatus('Could not render the card in this browser')
    } finally {
      setBusy(false)
    }
  }

  const handleShare = async () => {
    let blob: Blob | null = null
    setBusy(true)
    setStatus('Rendering card…')
    try {
      blob = await svgToPng(svg)
      const file = new File([blob], filename, { type: 'image/png' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: 'Apex Race Forecast', text: caption, url: PRODUCT_URL, files: [file] })
        setStatus('Card shared')
      } else {
        downloadBlob(blob, filename)
        const copied = await copyCaption(caption)
        setStatus(copied ? 'PNG downloaded · caption copied' : 'PNG downloaded')
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('')
        return
      }
      if (blob) {
        downloadBlob(blob, filename)
        const copied = await copyCaption(caption)
        setStatus(copied ? 'PNG downloaded · caption copied' : 'PNG downloaded')
      } else {
        setStatus('Could not render the card in this browser')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      className="share-card-dialog"
      ref={dialogRef}
      aria-labelledby="share-card-title"
      aria-describedby="share-card-description"
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) close() }}
    >
      <div className="share-card-sheet">
        <header>
          <div><span>SHAREABLE FORECAST</span><h2 id="share-card-title">Your track. Your result.</h2><p id="share-card-description">The image includes the authored circuit, forecast leader, top three, conditions, sample ID, and strategy impact.</p></div>
          <button type="button" onClick={close} aria-label="Close share card"><X size={20} /></button>
        </header>
        <div className="share-card-preview"><img src={previewUrl} width={1200} height={630} alt={`${simulation.circuit.name} forecast share card with ${winner.firstName} ${winner.lastName} leading at ${percent(leader.wins)}`} /></div>
        <footer>
          <span role="status" aria-live="polite">{status || '1200 × 630 PNG · ready for social sharing'}</span>
          <div>
            <button type="button" className="secondary-button" onClick={handleDownload} disabled={busy}><Download size={16} /> Download PNG</button>
            <button type="button" className="share-card-primary" onClick={handleShare} disabled={busy}><Share2 size={16} /> {busy ? 'Rendering…' : 'Share card'}</button>
          </div>
        </footer>
      </div>
    </dialog>
  )
}
