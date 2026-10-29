// App-level types. Components only ever see these shapes, never raw backend JSON.
// Backend field names live in contract.ts; if the backend changes, this file usually doesn't.

export type SpaceStatus = 'Available' | 'Reserved' | 'Occupied' | 'OutOfService'
export type SpaceKind = 'Standard' | 'EV'
export type ParkingKind = SpaceKind

export interface Space {
  id: string // "L2_SPACE_031"
  level: number // 1-4
  number: number | null // 31
  status: SpaceStatus
  kind: SpaceKind
}

export interface IntegrationStatus {
  /** Unity's last snapshot arrived within the backend's timeout. */
  connected: boolean
  /** Connected AND the data is a live Unity report (not seeded baseline / last-known). */
  live: boolean
  dataSource: 'SeededBaseline' | 'UnityLive' | 'UnityLastKnown'
  secondsSinceLastUpdate: number | null
  lastUpdateAt: string | null
  pendingCommands: number
  /** Changes when the backend restarts. Its in-memory IDs (REQ_…, VEH_…) may then be reused. */
  backendInstanceId: string
}

/** Unknown = Unity received it but no result arrived before a restart. Not a rejection; a car may exist. */
export type RequestOutcome = 'Pending' | 'Succeeded' | 'Failed' | 'Unknown'

/**
 * Why a request could not be served. Each gets different driver wording:
 * - capacity:  no compatible stall right now (GarageFull, e.g. all 8 EV stalls taken)
 * - levelFull: the preferred level has no compatible stall (LevelFull)
 * - vehicleLimit: the garage is at its maximum number of vehicles (VehicleLimitReached)
 * - closed:    garage isn't admitting new arrivals (e.g. draining)
 * - temporary: entrance busy/blocked (EntranceBlocked); spaces may exist, try again shortly
 * - cancelled: the simulation was reset/restarted before Unity ran the request
 * - unknown:   Unity received it, but the system restarted before confirming (OutcomeUnknown)
 * - offline:   backend answered 503: Unity isn't connected, nothing was queued
 * - rejected:  backend refused the request itself (HTTP 4xx)
 * - other:     anything unrecognised (the raw message is shown)
 */
export type FailureKind =
  | 'capacity'
  | 'levelFull'
  | 'vehicleLimit'
  | 'closed'
  | 'temporary'
  | 'cancelled'
  | 'unknown'
  | 'offline'
  | 'rejected'
  | 'other'

export interface SpawnRequestResult {
  requestId: string
  outcome: RequestOutcome
  /** Unity has picked the command up (still pending, but further along). */
  forwardedToUnity: boolean
  vehicleId: string | null
  failureReason: string | null
  failureKind: FailureKind | null
}

/** Outcome of a queued command (used for departures). */
export interface CommandResult {
  commandId: string
  outcome: 'Pending' | 'Succeeded' | 'Failed' | 'Unknown'
  message: string | null
  failureKind: FailureKind | null
}

export type VehicleStage =
  | 'Entering' // Spawned / RequestingAssignment
  | 'DrivingToSpace' // DrivingToStall
  | 'Parking'
  | 'Parked'
  | 'Departing' // Departing / DrivingToExit
  | 'Exited' // Completed
  | 'Failed'
  | 'Unknown'

export interface Vehicle {
  id: string
  stage: VehicleStage
  assignedSpaceId: string | null
  kind: SpaceKind
  failureReason: string | null
}

/** Everything the UI needs from the backend. */
export interface ParkingApi {
  getIntegrationStatus(signal?: AbortSignal): Promise<IntegrationStatus>
  listSpaces(signal?: AbortSignal): Promise<Space[]>
  /** Resolves when the backend has QUEUED the request (HTTP 202). Not a guarantee of a car or a stall. */
  requestParking(kind: ParkingKind, preferredLevel: number | null): Promise<{ requestId: string }>
  /** Throws NotFoundError if the backend doesn't know this request (e.g. backend restarted). */
  getSpawnRequest(requestId: string, signal?: AbortSignal): Promise<SpawnRequestResult>
  /** Returns null if the vehicle no longer exists (left the garage, or simulation reset). */
  getVehicle(vehicleId: string, signal?: AbortSignal): Promise<Vehicle | null>
  /** Queues a DepartVehicle command (HTTP 202). Unity validates it; track it with getCommand. */
  requestDeparture(vehicleId: string): Promise<{ commandId: string }>
  /** Throws NotFoundError if the backend doesn't know this command (e.g. backend restarted). */
  getCommand(commandId: string, signal?: AbortSignal): Promise<CommandResult>
}

export class NotFoundError extends Error {}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
