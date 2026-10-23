// Backend client: HTTP call → contract.ts parser → app type.
// The transport is swappable so demo mode (mockBackend.ts) runs through the exact same parsing code.

import { config } from '../config'
import {
  ENDPOINTS,
  errorMessage,
  parseCommand,
  parseCommandAccepted,
  parseIntegrationStatus,
  parseSpace,
  parseSpawnAccepted,
  parseSpawnRequest,
  parseVehicle,
  toSpawnBody,
  type RawBackendCommand,
  type RawCommandAccepted,
  type RawErrorBody,
  type RawIntegrationStatus,
  type RawParkingSpace,
  type RawVehicle,
  type RawVehicleSpawnRequest,
} from './contract'
import { ApiError, NotFoundError, type ParkingApi } from './types'

export interface TransportResponse {
  status: number
  body: unknown
}
export type Transport = (method: 'GET' | 'POST', path: string, body: unknown, signal: AbortSignal) => Promise<TransportResponse>

/** Real network transport. Paths are relative; Vite's dev proxy forwards them to FastAPI. */
export const fetchTransport: Transport = async (method, path, body, signal) => {
  const response = await fetch(config.apiBaseUrl + path, {
    method,
    signal,
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    /* empty or non-JSON body */
  }
  return { status: response.status, body: parsed }
}

export function createApi(transport: Transport): ParkingApi {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    // Combine the caller's abort signal with a timeout so a hung backend shows up as "offline".
    const timeout = AbortSignal.timeout(config.requestTimeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const res = await transport(method, path, body, combined)
    if (res.status === 404) throw new NotFoundError(path)
    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(res.status, errorMessage(res.body as RawErrorBody | null, `HTTP ${res.status}`))
    }
    return res.body as T
  }

  return {
    async getIntegrationStatus(signal) {
      return parseIntegrationStatus(await call<RawIntegrationStatus>('GET', ENDPOINTS.integrationStatus, undefined, signal))
    },

    async listSpaces(signal) {
      return (await call<RawParkingSpace[]>('GET', ENDPOINTS.spaces, undefined, signal)).map(parseSpace)
    },

    async requestParking(kind, preferredLevel) {
      // 202 = queued only. 503 = Unity offline, nothing queued (thrown as ApiError).
      const body = await call<RawCommandAccepted>('POST', ENDPOINTS.spawn, toSpawnBody(kind, preferredLevel))
      return parseSpawnAccepted(body)
    },

    async getSpawnRequest(requestId, signal) {
      return parseSpawnRequest(await call<RawVehicleSpawnRequest>('GET', ENDPOINTS.spawnRequest(requestId), undefined, signal))
    },

    async getVehicle(vehicleId, signal) {
      try {
        return parseVehicle(await call<RawVehicle>('GET', ENDPOINTS.vehicle(vehicleId), undefined, signal))
      } catch (error) {
        if (error instanceof NotFoundError) return null
        throw error
      }
    },

    async requestDeparture(vehicleId) {
      // 202 = DepartVehicle queued. Unity validates it; the car leaving shows up in its lifecycle_state.
      return parseCommandAccepted(await call<RawCommandAccepted>('POST', ENDPOINTS.depart(vehicleId)))
    },

    async getCommand(commandId, signal) {
      return parseCommand(await call<RawBackendCommand>('GET', ENDPOINTS.command(commandId), undefined, signal))
    },
  }
}
