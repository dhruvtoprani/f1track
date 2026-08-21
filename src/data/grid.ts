import type { Driver, Team } from '../types'
import { getLearnedDriverPrior, getLearnedTeamPrior } from './mlRuntime'

const baseTeams: Team[] = [
  { id: 'mercedes', name: 'Mercedes', shortName: 'MER', color: '#00a19c', accent: '#7fffe9', currentPoints: 379, car: { baseline: 98, highSpeed: 97, lowSpeed: 96, power: 98, traction: 96, tyreLife: 95, reliability: 96, strategy: 94 } },
  { id: 'ferrari', name: 'Ferrari', shortName: 'FER', color: '#e8002d', accent: '#ff785f', currentPoints: 307, car: { baseline: 96, highSpeed: 95, lowSpeed: 97, power: 96, traction: 96, tyreLife: 93, reliability: 94, strategy: 91 } },
  { id: 'mclaren', name: 'McLaren', shortName: 'MCL', color: '#ff8700', accent: '#ffc36b', currentPoints: 220, car: { baseline: 94, highSpeed: 96, lowSpeed: 94, power: 93, traction: 96, tyreLife: 97, reliability: 94, strategy: 95 } },
  { id: 'red-bull', name: 'Red Bull Racing', shortName: 'RBR', color: '#3671c6', accent: '#75a7ff', currentPoints: 177, car: { baseline: 92, highSpeed: 95, lowSpeed: 91, power: 93, traction: 92, tyreLife: 91, reliability: 91, strategy: 93 } },
  { id: 'racing-bulls', name: 'Racing Bulls', shortName: 'VCARB', color: '#6692ff', accent: '#b7c9ff', currentPoints: 66, car: { baseline: 87, highSpeed: 86, lowSpeed: 88, power: 86, traction: 89, tyreLife: 87, reliability: 90, strategy: 88 } },
  { id: 'alpine', name: 'Alpine', shortName: 'ALP', color: '#ff87bc', accent: '#7bbcff', currentPoints: 61, car: { baseline: 86, highSpeed: 84, lowSpeed: 88, power: 85, traction: 88, tyreLife: 86, reliability: 87, strategy: 85 } },
  { id: 'haas', name: 'Haas F1 Team', shortName: 'HAS', color: '#b6babd', accent: '#f2f2f2', currentPoints: 21, car: { baseline: 82, highSpeed: 83, lowSpeed: 81, power: 84, traction: 80, tyreLife: 82, reliability: 86, strategy: 84 } },
  { id: 'audi', name: 'Audi', shortName: 'AUD', color: '#d0ff00', accent: '#efffa6', currentPoints: 12, car: { baseline: 80, highSpeed: 80, lowSpeed: 81, power: 81, traction: 80, tyreLife: 81, reliability: 82, strategy: 82 } },
  { id: 'williams', name: 'Williams', shortName: 'WIL', color: '#64c4ff', accent: '#b6e5ff', currentPoints: 11, car: { baseline: 80, highSpeed: 82, lowSpeed: 78, power: 84, traction: 78, tyreLife: 80, reliability: 84, strategy: 83 } },
  { id: 'aston-martin', name: 'Aston Martin', shortName: 'AMR', color: '#229971', accent: '#74dab9', currentPoints: 1, car: { baseline: 76, highSpeed: 76, lowSpeed: 77, power: 77, traction: 76, tyreLife: 78, reliability: 82, strategy: 80 } },
  { id: 'cadillac', name: 'Cadillac', shortName: 'CAD', color: '#e7e7e7', accent: '#7fa7ff', currentPoints: 0, car: { baseline: 74, highSpeed: 75, lowSpeed: 73, power: 76, traction: 73, tyreLife: 75, reliability: 76, strategy: 78 } },
]

const blend = (currentSeason: number, learned: number | undefined, learnedWeight = 0.7) => (
  learned === undefined ? currentSeason : Number((currentSeason * (1 - learnedWeight) + learned * learnedWeight).toFixed(2))
)

export const teams: Team[] = baseTeams.map((team) => {
  const learned = getLearnedTeamPrior(team.name)
  if (!learned) return team
  return {
    ...team,
    car: {
      baseline: blend(team.car.baseline, learned.baseline),
      highSpeed: blend(team.car.highSpeed, learned.high_speed),
      lowSpeed: blend(team.car.lowSpeed, learned.low_speed),
      power: blend(team.car.power, learned.power),
      traction: blend(team.car.traction, learned.traction),
      tyreLife: blend(team.car.tyreLife, learned.tyre_life),
      reliability: blend(team.car.reliability, learned.reliability),
      strategy: blend(team.car.strategy, learned.strategy),
    },
  }
})

const d = (
  id: string, code: string, number: number, firstName: string, lastName: string,
  nationality: string, teamId: string, currentPoints: number,
  pace: number, qualifying: number, racecraft: number, tyreManagement: number,
  wet: number, consistency: number, risk: number,
): Driver => ({ id, code, number, firstName, lastName, nationality, teamId, currentPoints, skill: { pace, qualifying, racecraft, tyreManagement, wet, consistency, risk } })

const baseDrivers: Driver[] = [
  d('antonelli', 'ANT', 12, 'Kimi', 'Antonelli', 'ITA', 'mercedes', 219, 96, 96, 94, 91, 93, 91, 71),
  d('russell', 'RUS', 63, 'George', 'Russell', 'GBR', 'mercedes', 160, 96, 97, 95, 94, 95, 95, 54),
  d('hamilton', 'HAM', 44, 'Lewis', 'Hamilton', 'GBR', 'ferrari', 169, 96, 95, 98, 97, 99, 94, 57),
  d('leclerc', 'LEC', 16, 'Charles', 'Leclerc', 'MON', 'ferrari', 138, 97, 99, 95, 92, 94, 91, 67),
  d('norris', 'NOR', 4, 'Lando', 'Norris', 'GBR', 'mclaren', 128, 97, 97, 96, 96, 96, 94, 58),
  d('piastri', 'PIA', 81, 'Oscar', 'Piastri', 'AUS', 'mclaren', 92, 95, 95, 96, 95, 92, 95, 53),
  d('verstappen', 'VER', 3, 'Max', 'Verstappen', 'NED', 'red-bull', 109, 99, 99, 99, 97, 98, 97, 70),
  d('hadjar', 'HAD', 6, 'Isack', 'Hadjar', 'FRA', 'red-bull', 68, 91, 92, 91, 88, 88, 87, 73),
  d('lawson', 'LAW', 30, 'Liam', 'Lawson', 'NZL', 'racing-bulls', 43, 88, 88, 90, 86, 87, 87, 72),
  d('lindblad', 'LIN', 41, 'Arvid', 'Lindblad', 'GBR', 'racing-bulls', 23, 87, 88, 86, 84, 86, 82, 78),
  d('gasly', 'GAS', 10, 'Pierre', 'Gasly', 'FRA', 'alpine', 42, 91, 93, 91, 89, 91, 90, 61),
  d('colapinto', 'COL', 43, 'Franco', 'Colapinto', 'ARG', 'alpine', 19, 86, 87, 86, 84, 85, 83, 76),
  d('bearman', 'BEA', 87, 'Oliver', 'Bearman', 'GBR', 'haas', 18, 88, 88, 88, 85, 86, 86, 72),
  d('ocon', 'OCO', 31, 'Esteban', 'Ocon', 'FRA', 'haas', 3, 88, 88, 90, 89, 89, 90, 65),
  d('bortoleto', 'BOR', 5, 'Gabriel', 'Bortoleto', 'BRA', 'audi', 10, 87, 88, 87, 85, 86, 86, 69),
  d('hulkenberg', 'HUL', 27, 'Nico', 'Hulkenberg', 'GER', 'audi', 2, 89, 92, 89, 88, 88, 92, 52),
  d('sainz', 'SAI', 55, 'Carlos', 'Sainz', 'ESP', 'williams', 6, 92, 92, 93, 94, 91, 95, 52),
  d('albon', 'ALB', 23, 'Alexander', 'Albon', 'THA', 'williams', 5, 90, 92, 91, 88, 90, 91, 61),
  d('alonso', 'ALO', 14, 'Fernando', 'Alonso', 'ESP', 'aston-martin', 1, 94, 93, 98, 96, 98, 96, 68),
  d('stroll', 'STR', 18, 'Lance', 'Stroll', 'CAN', 'aston-martin', 0, 83, 82, 84, 83, 85, 82, 72),
  d('bottas', 'BOT', 77, 'Valtteri', 'Bottas', 'FIN', 'cadillac', 0, 88, 91, 88, 87, 88, 92, 47),
  d('perez', 'PER', 11, 'Sergio', 'Perez', 'MEX', 'cadillac', 0, 88, 86, 92, 95, 89, 87, 57),
]

export const drivers: Driver[] = baseDrivers.map((driver) => {
  const learned = getLearnedDriverPrior(driver.code)
  if (!learned) return driver
  return {
    ...driver,
    skill: {
      pace: blend(driver.skill.pace, learned.pace),
      qualifying: blend(driver.skill.qualifying, learned.qualifying),
      racecraft: blend(driver.skill.racecraft, learned.racecraft),
      tyreManagement: blend(driver.skill.tyreManagement, learned.tyre_management),
      wet: blend(driver.skill.wet, learned.wet),
      consistency: blend(driver.skill.consistency, learned.consistency),
      risk: blend(driver.skill.risk, learned.risk, 0.5),
    },
  }
})

export const teamById = new Map(teams.map((team) => [team.id, team]))
export const driverById = new Map(drivers.map((driver) => [driver.id, driver]))

export const calibrationSnapshot = {
  season: 2026,
  capturedAt: '2026-08-20',
  completedRounds: 11,
  sourceLabel: 'OpenF1 2023-2026 history + 2026 grid snapshot',
}
