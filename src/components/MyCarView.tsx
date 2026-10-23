import type { Session } from '../hooks/useParkingSession'
import { useNow } from '../hooks/useNow'
import { STAGE_COPY, describeSpace, formatClock, formatDuration } from '../lib/driverCopy'
import { BoltIcon, CheckIcon, ExitIcon, PinIcon } from './Icons'

interface Props {
  session: Session
  levels: number[]
  departureError: string | null
  onDepart: () => void
  onGoPark: () => void
  onReset: () => void
}

/** Simple floor stack (top floor first) with the driver's level highlighted. Not a map: just "which floor". */
function LevelStack({ levels, mine }: { levels: number[]; mine: number | null }) {
  const ordered = [...levels].sort((a, b) => b - a)
  return (
    <ol className="stack" aria-label="Garage levels">
      {ordered.map((l) => (
        <li key={l} className={`stack__floor${l === mine ? ' stack__floor--mine' : ''}`} aria-current={l === mine ? 'location' : undefined}>
          <span>Level {l}</span>
          {l === mine && (
            <span className="stack__you">
              <PinIcon size={14} /> Your car
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

export function MyCarView({ session, levels, departureError, onDepart, onGoPark, onReset }: Props) {
  const now = useNow(15000)

  if (session.phase === 'ended' && session.reason === 'exited') {
    return (
      <section className="card card--accent-navy">
        <div className="status-row">
          <CheckIcon size={22} className="text-good" />
          <div>
            <h2 className="card__title">You have left the garage</h2>
            <p className="card__lead">Your space has been released.</p>
          </div>
        </div>
        <button type="button" className="btn btn--primary btn--block" onClick={onReset}>
          Park again
        </button>
      </section>
    )
  }

  if (session.phase !== 'active') {
    const waiting = session.phase === 'pending' || session.phase === 'submitting'
    return (
      <section className="card empty">
        <PinIcon size={28} className="empty__icon" />
        <h2 className="card__title">{waiting ? 'Your space is on its way' : 'No parked car yet'}</h2>
        <p className="card__lead">
          {waiting
            ? 'Once the garage confirms your space, you will find it here.'
            : 'Request a space and we will remember where you parked.'}
        </p>
        <button type="button" className="btn btn--secondary" onClick={onGoPark}>
          {waiting ? 'View request' : 'Request a space'}
        </button>
      </section>
    )
  }

  const space = describeSpace(session.spaceId)
  const parked = session.stage === 'Parked'
  const leaving = session.stage === 'Departing'
  const departure = session.departure

  return (
    <>
      <section className="card card--accent-green" aria-labelledby="mycar-title">
        <p className="card__label" id="mycar-title">
          {parked || leaving || departure ? 'Your car is parked at' : 'Your assigned space'}
        </p>
        {space ? (
          <div className="space-hero">
            <span className="space-hero__level">{space.levelLabel}</span>
            <span className="space-hero__space">{space.spaceLabel}</span>
            {session.kind === 'EV' && (
              <span className="tag tag--ev">
                <BoltIcon size={12} /> EV charging
              </span>
            )}
          </div>
        ) : (
          <p className="card__lead">Waiting for the garage to confirm the location…</p>
        )}

        <dl className="facts">
          <div>
            <dt>Status</dt>
            <dd>{STAGE_COPY[session.stage].title}</dd>
          </div>
          {session.parkedAt && (
            <div>
              <dt>Parked</dt>
              <dd>
                {formatClock(session.parkedAt)} · {formatDuration(now - session.parkedAt)}
              </dd>
            </div>
          )}
        </dl>

        {space?.level && (
          <>
            <LevelStack levels={levels.length ? levels : [1, 2, 3, 4]} mine={space.level} />
            <p className="hint">
              Go to {space.levelLabel} and look for {space.spaceLabel.toLowerCase()}.
            </p>
          </>
        )}
      </section>

      <section className="card card--accent-amber" aria-labelledby="depart-title">
        <h2 id="depart-title" className="card__title">Leaving?</h2>
        {leaving ? (
          <div className="status-row" aria-live="polite">
            <span className="spinner" aria-hidden />
            <p className="card__lead">Heading to the exit. Your space is released when you leave.</p>
          </div>
        ) : departure ? (
          <div className="status-row" aria-live="polite">
            <span className="spinner" aria-hidden />
            <p className="card__lead">
              {departure.acknowledged
                ? 'Departure confirmed. Your car is getting ready to leave…'
                : 'Departure requested. Waiting for the garage to confirm…'}
            </p>
          </div>
        ) : (
          <>
            <p className="card__lead">Your car stays parked until you are ready. Let the garage know when you are leaving.</p>
            <button type="button" className="btn btn--primary btn--block" disabled={!parked} onClick={onDepart}>
              <ExitIcon size={16} /> Request departure
            </button>
            {!parked && <p className="hint">Available once you are parked.</p>}
          </>
        )}
        {departureError && !departure && (
          <p className="hint text-bad" role="alert">
            {departureError}
          </p>
        )}
      </section>
    </>
  )
}
