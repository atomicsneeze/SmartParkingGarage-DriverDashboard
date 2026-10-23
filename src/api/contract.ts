// ─────────────────────────────────────────────────────────────────────────────
// BACKEND CONTRACT: the ONLY file that knows the backend's JSON shapes.
//
// Raw* types mirror the Pydantic models in the team repo:
//   github.com/CEN4090L-Fall-2026/SmartParkingGarage → Backend/app/models/*.py
//   (checked against commit 3184c60; summary in docs/frontend-api.md)
// If the backend models change, update the Raw* types first. TypeScript will then
// point at every mapping below that needs to follow.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CommandResult,
  FailureKind,
  IntegrationStatus,
  ParkingKind,
  RequestOutcome,
  Space,
  SpawnRequestResult,
  Vehicle,
  VehicleStage,
} from './types'

export const ENDPOINTS = {
  integrationStatus: '/api/integration/status',
  spaces: '/api/spaces',
  spawn: '/api/vehicles/spawn',
  spawnRequest: (id: string) => `/api/vehicles/spawn-requests/${encodeURIComponent(id)}`,
  vehicle: (id: string) => `/api/vehicles/${encodeURIComponent(id)}`,
  depart: (vehicleId: string) => `/api/vehicles/${encodeURIComponent(vehicleId)}/depart`,
  command: (id: string) => `/api/integration/commands/${encodeURIComponent(id)}`,
}

// ── Raw backend types (enums.py) ─────────────────────────────────────────────

export type RawLevel = 'L1' | 'L2' | 'L3' | 'L4'
export type RawSpaceState = 'Available' | 'Occupied' | 'Reserved' | 'OutOfService'
export type RawSpaceType = 'Standard' | 'EV'
export type RawLifecycleState =
  | 'Spawned'
  | 'RequestingAssignment'
  | 'DrivingToStall'
  | 'Parking'
  | 'Parked'
  | 'Departing'
  | 'DrivingToExit'
  | 'Completed'
  | 'Failed'
/** Only SpawnedInUnity means a vehicle exists. */
export type RawSpawnRequestStatus = 'AcceptedByBackend' | 'ForwardedToUnity' | 'SpawnedInUnity' | 'Failed'
export type RawCommandStatus = 'Pending' | 'Delivered' | 'Acknowledged' | 'Failed' | 'Cancelled'
export type RawDataSource = 'SeededBaseline' | 'UnityLive' | 'UnityLastKnown'
/** CommandErrorCode: Unity's machine-readable failure reason (may be null; then use the message). */
export type RawErrorCode = 'GarageFull' | 'LevelFull' | 'VehicleLimitReached' | 'EntranceBlocked'

// ── Raw backend models ───────────────────────────────────────────────────────

/** parking.py → ParkingSpace (GET /api/spaces returns a bare list of these) */
export interface RawParkingSpace {
  space_id: string // "L1_SPACE_001". IDs are NOT contiguous, never generate them from a range
  level: RawLevel
  state: RawSpaceState
  space_type: RawSpaceType
  assigned_vehicle_id: string | null
  reserved_by: string | null
}

/** vehicles.py → Vehicle (GET /api/vehicles/{id}; 404 once it has left / after reset) */
export interface RawVehicle {
  vehicle_id: string // "VEH_0001"
  requester_id: string // "SIM_VEH_0001"
  request_type: RawSpaceType
  lifecycle_state: RawLifecycleState
  assigned_space_id: string | null
  preferred_level: RawLevel | null
  failure_reason: string | null
}

/** vehicles.py → VehicleSpawnRequest (GET /api/vehicles/spawn-requests/{id}) */
export interface RawVehicleSpawnRequest {
  request_id: string // "REQ_0001"
  request_type: RawSpaceType
  preferred_level: RawLevel | null
  auto_depart: boolean
  status: RawSpawnRequestStatus
  forwarded_to_unity: boolean
  spawned_in_unity: boolean
  vehicle_id: string | null
  command_id: string | null
  failure_reason: string | null // Unity's ack message (free text)
  error_code: RawErrorCode | null
}

/** integration.py → BackendCommand (only the fields the driver app reads).
 *  GET /api/integration/commands/{id}. Used to track a departure. */
export interface RawBackendCommand {
  command_id: string // "CMD_000001"
  command_type: string
  status: RawCommandStatus
  result_message: string | null
  vehicle_id: string | null
  error_code: RawErrorCode | null
}

/** responses.py → CommandAccepted (HTTP 202 from POST /api/vehicles/spawn and /{vehicle_id}/depart) */
export interface RawCommandAccepted {
  success: boolean
  message: string
  current_state: string | null
  command: RawBackendCommand
  request: RawVehicleSpawnRequest | null
}

/** commands.py → SpawnVehicleCommand (request body; extra fields are REJECTED with 422) */
export interface RawSpawnVehicleCommand {
  request_type: RawSpaceType
  preferred_level?: RawLevel | null
  /** Defaults to true (car leaves on its own). Driver requests send false: the car waits for the driver. */
  auto_depart?: boolean
}

/** integration.py → IntegrationStatus (GET /api/integration/status) */
export interface RawIntegrationStatus {
  connected: boolean
  unity_session_id: string | null
  latest_sequence: number
  last_update_at: string | null
  seconds_since_last_update: number | null
  timeout_seconds: number
  data_source: RawDataSource
  pending_commands: number
  backend_instance_id: string
}

/** main.py error handlers (404/409/503) use {success, message}; FastAPI's own 422 uses {detail}. */
export interface RawErrorBody {
  success?: false
  message?: string
  detail?: unknown
}

// ── Requests ─────────────────────────────────────────────────────────────────

export function toSpawnBody(kind: ParkingKind, preferredLevel: number | null): RawSpawnVehicleCommand {
  // auto_depart: false → the car stays parked until the driver presses "Request departure".
  const body: RawSpawnVehicleCommand = { request_type: kind, auto_depart: false }
  if (preferredLevel) body.preferred_level = `L${preferredLevel}` as RawLevel
  return body
}

export function parseSpawnAccepted(raw: RawCommandAccepted): { requestId: string } {
  if (!raw.request) throw new Error('Spawn response has no request record')
  return { requestId: raw.request.request_id }
}

export function parseCommandAccepted(raw: RawCommandAccepted): { commandId: string } {
  return { commandId: raw.command.command_id }
}

// ── Responses → app types ────────────────────────────────────────────────────

const levelNumber = (level: RawLevel) => Number(level.slice(1))

/** "L2_SPACE_031" → { level: 2, number: 31 } */
export function parseSpaceId(id: string): { level: number | null; number: number | null } {
  const match = /^L(\d+)_SPACE_(\d+)$/i.exec(id)
  return match ? { level: Number(match[1]), number: Number(match[2]) } : { level: null, number: null }
}

export function parseIntegrationStatus(raw: RawIntegrationStatus): IntegrationStatus {
  return {
    connected: raw.connected,
    live: raw.connected && raw.data_source === 'UnityLive',
    dataSource: raw.data_source,
    secondsSinceLastUpdate: raw.seconds_since_last_update,
    lastUpdateAt: raw.last_update_at,
    pendingCommands: raw.pending_commands,
    backendInstanceId: raw.backend_instance_id,
  }
}

export function parseSpace(raw: RawParkingSpace): Space {
  return {
    id: raw.space_id,
    level: levelNumber(raw.level),
    number: parseSpaceId(raw.space_id).number,
    status: raw.state,
    kind: raw.space_type,
  }
}

const OUTCOME: Record<RawSpawnRequestStatus, RequestOutcome> = {
  AcceptedByBackend: 'Pending',
  ForwardedToUnity: 'Pending',
  SpawnedInUnity: 'Succeeded',
  Failed: 'Failed',
}

const ERROR_CODE_KIND: Record<RawErrorCode, FailureKind> = {
  GarageFull: 'capacity',
  LevelFull: 'levelFull',
  VehicleLimitReached: 'vehicleLimit',
  EntranceBlocked: 'temporary',
}

/**
 * Unity sends an error_code when it can (GarageFull, LevelFull, VehicleLimitReached, EntranceBlocked).
 * Without a code, fall back to the free-text message. Known messages (Backend/tests/fake_unity.py):
 *   "No matching available space."                  → capacity
 *   "Manual arrivals are disabled while draining."  → closed
 *   "Unity session ended before this command…" / "Obsolete: superseded by reset…" → cancelled
 */
export function classifyFailure(code: RawErrorCode | null, message: string | null): FailureKind {
  if (code && ERROR_CODE_KIND[code]) return ERROR_CODE_KIND[code]
  const m = (message ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  if (/nomatching|noavailable|nocompatible|garagefull|capacity|exhaust/.test(m)) return 'capacity'
  if (/levelfull/.test(m)) return 'levelFull'
  if (/vehiclelimit|limitreached|toomany/.test(m)) return 'vehicleLimit'
  if (/drain|disabled|paused|notaccepting|closed/.test(m)) return 'closed'
  if (/cancel|obsolete|superseded|sessionended|reset/.test(m)) return 'cancelled'
  if (/entranceblocked|admission|blocked|busy|congest|traffic|temporar|tryagain/.test(m)) return 'temporary'
  return 'other'
}

export function parseSpawnRequest(raw: RawVehicleSpawnRequest): SpawnRequestResult {
  const outcome = OUTCOME[raw.status] ?? 'Pending'
  return {
    requestId: raw.request_id,
    outcome,
    forwardedToUnity: raw.forwarded_to_unity,
    vehicleId: raw.vehicle_id,
    failureReason: outcome === 'Failed' ? raw.failure_reason : null,
    failureKind: outcome === 'Failed' ? classifyFailure(raw.error_code, raw.failure_reason) : null,
  }
}

const STAGE: Record<RawLifecycleState, VehicleStage> = {
  Spawned: 'Entering',
  RequestingAssignment: 'Entering',
  DrivingToStall: 'DrivingToSpace',
  Parking: 'Parking',
  Parked: 'Parked',
  Departing: 'Departing',
  DrivingToExit: 'Departing',
  Completed: 'Exited',
  Failed: 'Failed',
}

export function parseVehicle(raw: RawVehicle): Vehicle {
  return {
    id: raw.vehicle_id,
    stage: STAGE[raw.lifecycle_state] ?? 'Unknown',
    assignedSpaceId: raw.assigned_space_id,
    kind: raw.request_type,
    failureReason: raw.failure_reason,
  }
}

const COMMAND_OUTCOME: Record<RawCommandStatus, CommandResult['outcome']> = {
  Pending: 'Pending',
  Delivered: 'Pending',
  Acknowledged: 'Succeeded', // Unity accepted it. For a departure this does NOT mean the car has left yet.
  Failed: 'Failed',
  Cancelled: 'Failed',
}

export function parseCommand(raw: RawBackendCommand): CommandResult {
  const outcome = COMMAND_OUTCOME[raw.status] ?? 'Pending'
  return {
    commandId: raw.command_id,
    outcome,
    message: raw.result_message,
    failureKind: outcome === 'Failed' ? (raw.status === 'Cancelled' ? 'cancelled' : classifyFailure(raw.error_code, raw.result_message)) : null,
  }
}

/** Human-readable message from any error body. */
export function errorMessage(body: RawErrorBody | null, fallback: string): string {
  if (body?.message) return body.message
  if (typeof body?.detail === 'string') return body.detail
  if (Array.isArray(body?.detail)) return 'The request was not in the format the backend expects.'
  return fallback
}
