// Turns system vocabulary into words a driver understands. Keep all driver-facing phrasing here.

import { parseSpaceId } from '../api/contract.ts'
import type { FailureKind, ParkingKind, VehicleStage } from '../api'

export function describeSpace(spaceId: string | null) {
  if (!spaceId) return null
  const { level, number } = parseSpaceId(spaceId)
  return {
    level,
    levelLabel: level ? `Level ${level}` : 'Level ?',
    spaceLabel: number ? `Space ${number}` : spaceId,
    full: level && number ? `Level ${level} · Space ${number}` : spaceId,
  }
}

export const kindLabel = (kind: ParkingKind) => (kind === 'EV' ? 'EV charging' : 'Standard')

export const STAGE_COPY: Record<VehicleStage, { title: string; hint: string }> = {
  Entering: { title: 'Entering the garage', hint: 'Your space is being confirmed as you enter.' },
  DrivingToSpace: { title: 'Head to your space', hint: 'Your space is held for you. Follow the garage signs to your level.' },
  Parking: { title: 'Pulling in', hint: 'You are at your space. Finishing parking.' },
  Parked: { title: 'You are parked', hint: 'We saved where you parked. Use My car to find it later.' },
  Departing: { title: 'On your way out', hint: 'Heading to the exit. Your space is released when you leave.' },
  Exited: { title: 'You have left the garage', hint: 'Thanks for parking with us.' },
  Failed: { title: 'Something went wrong', hint: 'The garage could not complete parking for this car.' },
  Unknown: { title: 'Space confirmed', hint: 'Waiting for the garage to report your car.' },
}

/** `reason` is the raw backend/Unity message; shown only where it helps (unrecognised failures). */
export function failureCopy(kind: FailureKind, parking: ParkingKind, reason: string | null) {
  switch (kind) {
    case 'capacity':
      return parking === 'EV'
        ? { title: 'No EV charging spaces open', body: 'All EV charging spaces are taken right now. You can park in a standard space instead, or try again later.' }
        : { title: 'No spaces open', body: 'There is no open space right now. Please try again in a few minutes.' }
    case 'levelFull':
      return { title: 'That level is full', body: 'There is no open space on the level you picked. You can choose another level or let the garage pick any level.' }
    case 'vehicleLimit':
      return { title: 'Garage is at its vehicle limit', body: 'The garage has reached the most cars it can handle right now. Please try again in a few minutes.' }
    case 'closed':
      return { title: 'Garage is not accepting arrivals', body: 'The garage is not letting new cars in at the moment. Please try again later.' }
    case 'temporary':
      return { title: 'Entrance is busy', body: 'Spaces are available, but the entrance is busy at the moment. Please try again shortly.' }
    case 'offline':
      return { title: 'Garage is offline', body: 'The garage is not connected right now, so your request was not sent. Please try again in a moment.' }
    case 'cancelled':
      return { title: 'Request cancelled', body: `Your request was cancelled before a space was assigned${reason ? ` (${reason})` : ''}. Please request again.` }
    case 'unknown':
      return { title: 'We could not confirm your request', body: 'The parking system restarted while your request was being handled, so it may or may not have gone through. Check before requesting again.' }
    case 'rejected':
      return { title: 'Request not accepted', body: `The parking system did not accept this request${reason ? `: ${reason}` : '.'}` }
    default:
      return { title: 'We could not get you a space', body: `Something went wrong${reason ? ` (${reason})` : ''}. Please try again.` }
  }
}

export function formatClock(ts: number | string | null) {
  if (ts === null) return '—'
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatDuration(ms: number) {
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'less than a minute'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h} hr ${mins % 60} min`
}
