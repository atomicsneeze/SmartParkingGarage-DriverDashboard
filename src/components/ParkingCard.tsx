import { useState } from 'react'
import type { ParkingKind } from '../api'
import { config } from '../config'
import type { Session } from '../hooks/useParkingSession'
import { useNow } from '../hooks/useNow'
import { availableFor, type Availability } from '../lib/availability'
import { STAGE_COPY, describeSpace, failureCopy, kindLabel } from '../lib/driverCopy'
import { AlertIcon, BoltIcon, CarIcon, CheckIcon } from './Icons'

interface Props {
  session: Session
  availability: Availability | null
  canRequest: boolean
  onRequest: (kind: ParkingKind, level?: number | null) => void
  onReset: () => void
  onOpenMyCar: () => void
}

export function ParkingCard(props: Props) {
  const { session } = props
  switch (session.phase) {
    case 'idle':
      return <RequestForm {...props} />
    case 'submitting':
    case 'pending':
      return <Pending session={session} onReset={props.onReset} />
    case 'active':
      return <Assigned session={session} onOpenMyCar={props.onOpenMyCar} />
    case 'failed':
      return <Failed {...props} session={session} />
    case 'ended':
      return <Ended session={session} onReset={props.onReset} />
  }
}

// ── Steps: Requested → Space assigned → Parked ──────────────────────────────

function Steps({ current }: { current: 0 | 1 | 2 | 3 }) {
  const steps = ['Requested', 'Space assigned', 'Parked']
  return (
    <ol className="steps" aria-label="Parking progress">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={label} className={`steps__item steps__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="steps__dot" aria-hidden />
            {label}
          </li>
        )
      })}
    </ol>
  )
}

// ── Idle: choose a type and request ─────────────────────────────────────────

function RequestForm({ availability, canRequest, onRequest }: Props) {
  const [kind, setKind] = useState<ParkingKind>('Standard')
  const [level, setLevel] = useState<number | null>(null)
  const open = (k: ParkingKind) => (availability ? availableFor(availability, k) : null)
  const selectedOpen = open(kind)
  const disabled = !canRequest || !selectedOpen
  // EV stalls exist only on Level 2, so a level preference only matters for Standard.
  const levelChoices = kind === 'Standard' ? (availability?.levels ?? []) : []

  return (
    <section className="card card--accent-navy" aria-labelledby="request-title">
      <h2 id="request-title" className="card__title">Request a space</h2>
      <p className="card__lead">Choose a space type. The garage assigns you the best open space.</p>

      <div className="choice" role="radiogroup" aria-label="Space type">
        {(['Standard', 'EV'] as const).map((k) => {
          const n = open(k)
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={`choice__option${kind === k ? ' choice__option--selected' : ''}`}
              onClick={() => setKind(k)}
            >
              <span className="choice__icon">{k === 'EV' ? <BoltIcon size={18} /> : <CarIcon size={18} />}</span>
              <span className="choice__name">{kindLabel(k)}</span>
              <span className={`choice__count${n === 0 ? ' text-bad' : ''}`}>
                {n === null ? '—' : n === 0 ? 'Full' : `${n} open`}
              </span>
            </button>
          )
        })}
      </div>

      {levelChoices.length > 0 && (
        <fieldset className="levelpick">
          <legend className="levelpick__legend">Preferred level <span className="levelpick__optional">(optional)</span></legend>
          <div className="levelpick__chips">
            <button type="button" className={`chip${level === null ? ' chip--selected' : ''}`} aria-pressed={level === null} onClick={() => setLevel(null)}>
              Any
            </button>
            {levelChoices.map((l) => {
              const n = l.available - l.evAvailable
              return (
                <button
                  key={l.level}
                  type="button"
                  className={`chip${level === l.level ? ' chip--selected' : ''}`}
                  aria-pressed={level === l.level}
                  aria-label={`Level ${l.level}, ${n} open`}
                  onClick={() => setLevel(l.level)}
                >
                  L{l.level}
                  <span className="chip__count">{n}</span>
                </button>
              )
            })}
          </div>
          {level !== null && <p className="hint">The garage will try to place you on Level {level}.</p>}
        </fieldset>
      )}
      {kind === 'EV' && <p className="hint">EV charging spaces are on Level 2.</p>}

      <button type="button" className="btn btn--primary btn--block" disabled={disabled} onClick={() => onRequest(kind, kind === 'Standard' ? level : null)}>
        Find me a space
      </button>
      {!canRequest && <p className="hint">Requests are paused until the garage is back online.</p>}
      {canRequest && selectedOpen === 0 && (
        <p className="hint">
          No {kind === 'EV' ? 'EV charging' : 'standard'} spaces are open right now.
          {kind === 'EV' && open('Standard') ? ' You can still request a standard space.' : ''}
        </p>
      )}
    </section>
  )
}

// ── Pending: queued, waiting for Unity's real answer ────────────────────────

function Pending({ session, onReset }: { session: Extract<Session, { phase: 'submitting' | 'pending' }>; onReset: () => void }) {
  const now = useNow()
  const waited = Math.max(0, now - session.startedAt)
  const slow = waited > config.slowRequestAfterMs

  return (
    <section className="card card--accent-blue" aria-live="polite" aria-labelledby="pending-title">
      <Steps current={1} />
      <div className="status-row">
        <span className="spinner" aria-hidden />
        <div>
          <h2 id="pending-title" className="card__title">Finding you a space…</h2>
          <p className="card__lead">
            {session.phase === 'submitting'
              ? 'Sending your request.'
              : session.forwarded
                ? `The garage is choosing your ${kindLabel(session.kind).toLowerCase()} space.`
                : 'Request received. Waiting for the garage to pick it up.'}
          </p>
        </div>
      </div>
      <p className="meta">Waiting {Math.round(waited / 1000)}s</p>
      {slow && (
        <div className="notice">
          <p>This is taking longer than usual. The garage may be busy or paused.</p>
          <button type="button" className="btn btn--link" onClick={onReset}>
            Stop waiting
          </button>
        </div>
      )}
    </section>
  )
}

// ── Assigned / arriving / parked ────────────────────────────────────────────

function Assigned({ session, onOpenMyCar }: { session: Extract<Session, { phase: 'active' }>; onOpenMyCar: () => void }) {
  const space = describeSpace(session.spaceId)
  const copy = STAGE_COPY[session.stage]
  const step = session.stage === 'Parked' || session.stage === 'Departing' ? 3 : 2

  return (
    <section className="card card--accent-green" aria-live="polite" aria-labelledby="assigned-title">
      <Steps current={step} />
      <p className="card__label">Your space</p>
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
        <p className="card__lead">Space confirmed. Waiting for its location…</p>
      )}
      <h2 id="assigned-title" className="card__title">{copy.title}</h2>
      <p className="card__lead">{copy.hint}</p>
      {session.stage === 'Parked' && (
        <button type="button" className="btn btn--secondary btn--block" onClick={onOpenMyCar}>
          Open My car
        </button>
      )}
    </section>
  )
}

// ── Could not serve ─────────────────────────────────────────────────────────

function Failed({ session, availability, canRequest, onRequest, onReset }: Props & { session: Extract<Session, { phase: 'failed' }> }) {
  const copy = failureCopy(session.failureKind, session.kind, session.reason)
  const standardOpen = availability ? availability.standardAvailable : 0
  const offerStandard = session.kind === 'EV' && session.failureKind === 'capacity' && standardOpen > 0
  const offerAnyLevel = session.failureKind === 'levelFull' && session.level !== null
  // "Try again soon" situations get amber; real failures get red.
  const soft = ['temporary', 'offline', 'closed', 'cancelled', 'unknown', 'levelFull', 'vehicleLimit'].includes(session.failureKind)

  return (
    <section className={`card ${soft ? 'card--accent-amber' : 'card--accent-red'}`} role="alert">
      <div className="status-row">
        <AlertIcon size={22} className={soft ? 'text-warn' : 'text-bad'} />
        <div>
          <h2 className="card__title">{copy.title}</h2>
          <p className="card__lead">{copy.body}</p>
        </div>
      </div>
      <div className="btn-row">
        {offerAnyLevel && (
          <button type="button" className="btn btn--primary" disabled={!canRequest} onClick={() => onRequest(session.kind, null)}>
            Try any level
          </button>
        )}
        {offerStandard && (
          <button type="button" className="btn btn--primary" disabled={!canRequest} onClick={() => onRequest('Standard')}>
            Request a standard space
          </button>
        )}
        <button
          type="button"
          className={offerStandard || offerAnyLevel ? 'btn btn--secondary' : 'btn btn--primary'}
          disabled={!canRequest}
          onClick={() => onRequest(session.kind, session.level)}
        >
          Try again
        </button>
        <button type="button" className="btn btn--link" onClick={onReset}>
          Back
        </button>
      </div>
    </section>
  )
}

// ── Finished / lost ─────────────────────────────────────────────────────────

function Ended({ session, onReset }: { session: Extract<Session, { phase: 'ended' }>; onReset: () => void }) {
  const exited = session.reason === 'exited'
  return (
    <section className="card card--accent-navy">
      <div className="status-row">
        {exited ? <CheckIcon size={22} className="text-good" /> : <AlertIcon size={22} className="text-warn" />}
        <div>
          <h2 className="card__title">{exited ? 'You have left the garage' : 'We lost track of your car'}</h2>
          <p className="card__lead">
            {exited
              ? 'Your space has been released. Thanks for parking with us.'
              : 'The garage no longer has a record of this car. This can happen if the system was restarted.'}
          </p>
        </div>
      </div>
      <button type="button" className="btn btn--primary btn--block" onClick={onReset}>
        {exited ? 'Park again' : 'Start over'}
      </button>
    </section>
  )
}
