import { useState } from 'react'
import { resetMockState } from './api/mockBackend'
import { AvailabilityCard } from './components/AvailabilityCard'
import { ConnectionBanner, ConnectionPill } from './components/Connection'
import { ParkIcon, PinIcon } from './components/Icons'
import { MyCarView } from './components/MyCarView'
import { ParkingCard } from './components/ParkingCard'
import { MOCK_SCENARIOS, config } from './config'
import { useGarageFeed } from './hooks/useGarageFeed'
import { useParkingSession } from './hooks/useParkingSession'
import { describeSpace, formatClock } from './lib/driverCopy'

type Tab = 'park' | 'car'

export default function App() {
  const feed = useGarageFeed()
  const parking = useParkingSession()
  const [tab, setTab] = useState<Tab>('park')

  const { session } = parking
  const canRequest = feed.connection === 'online'
  const myLevel = session.phase === 'active' ? (describeSpace(session.spaceId)?.level ?? null) : null
  const hasCar = session.phase === 'active'

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Smart Parking Garage</p>
          <h1 className="title">{tab === 'park' ? 'Find a space' : 'My car'}</h1>
        </div>
        <ConnectionPill connection={feed.connection} />
      </header>

      <main className="content">
        <ConnectionBanner connection={feed.connection} lastSuccessAt={feed.lastSuccessAt} />

        {tab === 'park' ? (
          <>
            <ParkingCard
              session={session}
              availability={feed.availability}
              canRequest={canRequest}
              onRequest={parking.requestSpace}
              onReset={parking.reset}
              onOpenMyCar={() => setTab('car')}
            />
            <AvailabilityCard availability={feed.availability} highlightLevel={myLevel} />
          </>
        ) : (
          <MyCarView
            session={session}
            levels={feed.availability?.levels.map((l) => l.level) ?? []}
            departureError={parking.departureError}
            onDepart={parking.requestDeparture}
            onGoPark={() => setTab('park')}
            onReset={() => {
              parking.reset()
              setTab('park')
            }}
          />
        )}

        <footer className="footer">
          <span>Updates automatically</span>
          <span>Last update {feed.lastSuccessAt ? formatClock(feed.lastSuccessAt) : '—'}</span>
          {config.mockScenario && <MockControls />}
        </footer>
      </main>

      <nav className="tabbar" aria-label="Main">
        <button type="button" className={`tabbar__item${tab === 'park' ? ' tabbar__item--active' : ''}`} aria-current={tab === 'park' ? 'page' : undefined} onClick={() => setTab('park')}>
          <ParkIcon size={20} />
          Park
        </button>
        <button type="button" className={`tabbar__item${tab === 'car' ? ' tabbar__item--active' : ''}`} aria-current={tab === 'car' ? 'page' : undefined} onClick={() => setTab('car')}>
          <span className="tabbar__icon">
            <PinIcon size={20} />
            {hasCar && <span className="tabbar__badge" aria-label="Car tracked" />}
          </span>
          My car
        </button>
      </nav>
    </div>
  )
}

/** Developer-only controls, shown when running on mock data. */
function MockControls() {
  return (
    <div className="mock">
      <label>
        Demo data:{' '}
        <select
          value={config.mockScenario ?? 'normal'}
          onChange={(e) => {
            const url = new URL(window.location.href)
            url.searchParams.set('mock', e.target.value)
            window.location.href = url.toString()
          }}
        >
          {MOCK_SCENARIOS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn--link"
        onClick={() => {
          resetMockState()
          try {
            localStorage.removeItem('driver-dashboard:session')
          } catch {
            /* ignore */
          }
          window.location.reload()
        }}
      >
        Reset demo
      </button>
    </div>
  )
}
