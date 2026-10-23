import type { Space, SpaceKind } from '../api'

export interface LevelAvailability {
  level: number
  available: number // Standard + EV that are Available
  operational: number // everything except OutOfService
  evAvailable: number
  evOperational: number
}

export interface Availability {
  standardAvailable: number
  standardOperational: number
  evAvailable: number
  evOperational: number
  totalAvailable: number
  totalOperational: number
  levels: LevelAvailability[]
}

/**
 * Driver-facing counts. OutOfService stalls are never counted as capacity,
 * and Reserved stalls are not "available" (another car is already heading there).
 */
export function summarize(spaces: Space[]): Availability {
  const byLevel = new Map<number, LevelAvailability>()
  const totals = { Standard: { available: 0, operational: 0 }, EV: { available: 0, operational: 0 } }

  for (const space of spaces) {
    if (space.status === 'OutOfService') continue
    const level = byLevel.get(space.level) ?? { level: space.level, available: 0, operational: 0, evAvailable: 0, evOperational: 0 }
    const open = space.status === 'Available'
    level.operational++
    if (open) level.available++
    if (space.kind === 'EV') {
      level.evOperational++
      if (open) level.evAvailable++
    }
    totals[space.kind].operational++
    if (open) totals[space.kind].available++
    byLevel.set(space.level, level)
  }

  return {
    standardAvailable: totals.Standard.available,
    standardOperational: totals.Standard.operational,
    evAvailable: totals.EV.available,
    evOperational: totals.EV.operational,
    totalAvailable: totals.Standard.available + totals.EV.available,
    totalOperational: totals.Standard.operational + totals.EV.operational,
    levels: [...byLevel.values()].sort((a, b) => a.level - b.level),
  }
}

export function availableFor(a: Availability, kind: SpaceKind) {
  return kind === 'EV' ? a.evAvailable : a.standardAvailable
}
