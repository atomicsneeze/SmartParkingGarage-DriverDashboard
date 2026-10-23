import { config } from '../config'
import { createApi, fetchTransport } from './httpClient'
import { createMockTransport } from './mockBackend'
import type { ParkingApi } from './types'

/** The backend the app uses: live FastAPI, or the in-browser demo backend (same client + parsers). */
export const api: ParkingApi = createApi(config.mockScenario ? createMockTransport(config.mockScenario) : fetchTransport)

export * from './types'
