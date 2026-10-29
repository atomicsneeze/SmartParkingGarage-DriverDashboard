// Central app settings. Everything here can be changed without touching components.

function readMockScenario(): MockScenario | null {
  const fromUrl = new URLSearchParams(window.location.search).get('mock')
  if (fromUrl !== null) {
    if (fromUrl === '' || fromUrl === '1' || fromUrl === 'true') return 'normal'
    if (fromUrl === '0' || fromUrl === 'false') return null
    return (MOCK_SCENARIOS as readonly string[]).includes(fromUrl) ? (fromUrl as MockScenario) : 'normal'
  }
  return import.meta.env.VITE_DATA_SOURCE === 'mock' ? 'normal' : null
}

/** Demo scenarios for building the UI without FastAPI/Unity running. Use ?mock=<name>. */
export const MOCK_SCENARIOS = [
  'normal', // requests succeed and the car parks after a few seconds
  'evfull', // all 8 EV stalls taken -> EV requests fail with GarageFull
  'draining', // simulation draining -> Unity refuses manual arrivals
  'blocked', // EntranceBlocked -> "entrance is busy", spaces still exist
  'levelfull', // a preferred-level request fails with LevelFull (no preference still succeeds)
  'limit', // VehicleLimitReached -> garage at its vehicle limit
  'nodepart', // parking works, but Unity refuses the departure command
  'unknown', // backend restarted before Unity confirmed -> OutcomeUnknown
  'slow', // Unity never picks up the command
  'stale', // backend up, Unity stopped reporting -> spawn returns 503
  'offline', // backend unreachable
] as const
export type MockScenario = (typeof MOCK_SCENARIOS)[number]

export const config = {
  /** Requests go to the same origin; Vite's dev proxy forwards them to FastAPI (see vite.config.ts). */
  apiBaseUrl: '',
  /** Unity reports ~1 Hz, so polling faster than this gains nothing. Matches the Operator Dashboard. */
  pollIntervalMs: 1000,
  /** Abort a single HTTP call after this long so a hung backend shows up as "offline". */
  requestTimeoutMs: 4000,
  /** After this long in "pending", tell the driver it's taking longer than usual. */
  slowRequestAfterMs: 15000,
  /** null = live backend; otherwise the mock scenario in use. */
  mockScenario: readMockScenario(),
} as const
