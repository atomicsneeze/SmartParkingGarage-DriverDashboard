import { useMemo } from 'react'
import { api, type IntegrationStatus, type Space } from '../api'
import { config } from '../config'
import { summarize, type Availability } from '../lib/availability'
import { usePolling } from './usePolling'

/**
 * connecting      – first load
 * online          – backend reachable and Unity reporting fresh, live data
 * unity-offline   – backend up, but Unity isn't connected / data is stale / still seeded defaults
 * backend-offline – can't reach FastAPI at all
 */
export type Connection = 'connecting' | 'online' | 'unity-offline' | 'backend-offline'

export interface GarageFeed {
  connection: Connection
  availability: Availability | null
  spaces: Space[]
  status: IntegrationStatus | null
  lastSuccessAt: number | null
}

/** Live garage availability + connection health, refreshed about once a second. */
export function useGarageFeed(): GarageFeed {
  const poll = usePolling(
    async (signal) => {
      const [status, spaces] = await Promise.all([api.getIntegrationStatus(signal), api.listSpaces(signal)])
      return { status, spaces }
    },
    config.pollIntervalMs,
  )

  const availability = useMemo(() => (poll.data ? summarize(poll.data.spaces) : null), [poll.data])

  let connection: Connection = 'connecting'
  // On error we keep showing the last good data (flagged as old by the banner).
  if (poll.error) connection = 'backend-offline'
  else if (poll.data) {
    // live = Unity reported within the backend's timeout AND data_source is UnityLive
    // (not the SeededBaseline used before Unity first reports, nor UnityLastKnown after it goes quiet).
    connection = poll.data.status.live ? 'online' : 'unity-offline'
  }

  return {
    connection,
    availability,
    spaces: poll.data?.spaces ?? [],
    status: poll.data?.status ?? null,
    lastSuccessAt: poll.lastSuccessAt,
  }
}
