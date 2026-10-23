import type { Availability } from '../lib/availability'
import { BoltIcon } from './Icons'

function Meter({ value, max, tone = 'green' }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={`meter__fill meter__fill--${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function AvailabilityCard({ availability, highlightLevel }: { availability: Availability | null; highlightLevel?: number | null }) {
  if (!availability) {
    return (
      <section className="card card--accent-green" aria-busy="true">
        <p className="card__label">Open spaces</p>
        <div className="skeleton skeleton--big" />
        <div className="skeleton" />
      </section>
    )
  }

  const a = availability
  return (
    <section className="card card--accent-green" aria-labelledby="avail-title">
      <div className="card__row">
        <h2 id="avail-title" className="card__label">Open spaces</h2>
        <span className="card__meta">of {a.totalOperational} in service</span>
      </div>
      <p className="hero-number">
        <span className={a.totalAvailable > 0 ? 'text-good' : 'text-bad'}>{a.totalAvailable}</span>
        <span className="hero-number__unit">{a.totalAvailable === 1 ? 'space' : 'spaces'} open now</span>
      </p>

      <div className="split">
        <div className="split__item">
          <span className="split__label">Standard</span>
          <span className="split__value">{a.standardAvailable}</span>
        </div>
        <div className="split__item">
          <span className="split__label">
            <BoltIcon size={14} className="icon-ev" /> EV charging
          </span>
          <span className="split__value">
            {a.evAvailable}
            <span className="split__of"> / {a.evOperational}</span>
          </span>
        </div>
      </div>

      <h3 className="subhead">By level</h3>
      <ul className="levels">
        {a.levels.map((l) => (
          <li key={l.level} className={`levels__row${highlightLevel === l.level ? ' levels__row--mine' : ''}`}>
            <span className="levels__tag">L{l.level}</span>
            <div className="levels__bar">
              <Meter value={l.available} max={l.operational} />
            </div>
            <span className="levels__count">
              <strong>{l.available}</strong> open
              {l.evOperational > 0 && <span className="levels__ev">·<BoltIcon size={12} className="icon-ev" />{l.evAvailable} EV</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
