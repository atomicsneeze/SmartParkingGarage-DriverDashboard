import type { Connection } from '../hooks/useGarageFeed'
import { formatClock } from '../lib/driverCopy'

const PILL: Record<Connection, { label: string; tone: string }> = {
  connecting: { label: 'Connecting', tone: 'neutral' },
  online: { label: 'Live', tone: 'good' },
  'unity-offline': { label: 'Garage offline', tone: 'warn' },
  'backend-offline': { label: 'No connection', tone: 'bad' },
}

export function ConnectionPill({ connection }: { connection: Connection }) {
  const { label, tone } = PILL[connection]
  return (
    <span className={`pill pill--${tone}`} role="status">
      <span className="pill__dot" aria-hidden />
      {label}
    </span>
  )
}

/** Shown only when something is wrong, so drivers never act on stale numbers without knowing. */
export function ConnectionBanner({ connection, lastSuccessAt }: { connection: Connection; lastSuccessAt: number | null }) {
  if (connection === 'online' || connection === 'connecting') return null
  const since = lastSuccessAt ? ` Last update ${formatClock(lastSuccessAt)}.` : ''
  const text =
    connection === 'backend-offline'
      ? `We can't reach the parking system right now, so numbers below may be out of date.${since}`
      : `The garage isn't sending live updates right now. Space counts may be out of date and new requests are paused.`
  return (
    <div className={`banner banner--${connection === 'backend-offline' ? 'bad' : 'warn'}`} role="alert">
      {text}
    </div>
  )
}
