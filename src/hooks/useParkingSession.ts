import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, NotFoundError, type FailureKind, type ParkingKind, type VehicleStage } from '../api'
import { config } from '../config'
import { readJson, writeJson } from '../lib/storage'

/**
 * The driver's journey, as a small state machine:
 *
 *   idle ─request─▶ submitting ─202─▶ pending ─SpawnedInUnity─▶ active ─Completed / 404─▶ ended
 *                        │               │                        │
 *                        └─503/4xx─▶ failed ◀──── Failed ──────────┘ (lifecycle Failed)
 *
 * While active, "Request departure" queues a DepartVehicle command; its outcome is tracked separately
 * (Acknowledged only means Unity accepted it; the car leaving shows up in its lifecycle_state).
 *
 * Saved to localStorage so a page refresh resumes tracking the same request/vehicle instead of
 * submitting again. If the backend restarts (backend_instance_id changes), its in-memory IDs may be
 * reused, so tracking stops rather than following someone else's car.
 */
export interface Departure {
  commandId: string | null // null while the POST is in flight
  requestedAt: number
  acknowledged: boolean // Unity accepted it; now waiting for the car to actually leave
}

export type Session =
  | { phase: 'idle' }
  | { phase: 'submitting'; kind: ParkingKind; level: number | null; startedAt: number }
  | {
      phase: 'pending'
      kind: ParkingKind
      level: number | null
      requestId: string
      startedAt: number
      forwarded: boolean
      instanceId: string | null
    }
  | {
      phase: 'active'
      kind: ParkingKind
      requestId: string
      vehicleId: string
      spaceId: string | null
      stage: VehicleStage
      startedAt: number
      parkedAt: number | null
      departure: Departure | null
      instanceId: string | null
    }
  | { phase: 'failed'; kind: ParkingKind; level: number | null; failureKind: FailureKind; reason: string | null }
  | { phase: 'ended'; kind: ParkingKind; spaceId: string | null; reason: 'exited' | 'missing'; endedAt: number }

const STORAGE_KEY = 'driver-dashboard:session'
/** Unity acknowledges the spawn slightly before the vehicle appears in its next ~1 s snapshot. */
const VEHICLE_GRACE_MS = 6000
/** A request id the backend doesn't know (backend restarted) is given up on after this long. */
const UNKNOWN_REQUEST_GIVE_UP_MS = 5000

function loadSession(): Session {
  const saved = readJson<Session>(STORAGE_KEY)
  if (!saved) return { phase: 'idle' }
  if (saved.phase === 'submitting') {
    // Refreshed during the POST itself (a fraction of a second). The backend's request id never reached
    // us, so we can't look it up, and re-sending could create a second car. Be honest about it.
    return { phase: 'failed', kind: saved.kind, level: saved.level, failureKind: 'other', reason: 'the page reloaded before the garage confirmed your request' }
  }
  return saved
}

export function useParkingSession(backendInstanceId: string | null) {
  const [session, setSessionState] = useState<Session>(loadSession)
  const [departureError, setDepartureError] = useState<string | null>(null)

  const setSession = useCallback((next: Session | ((prev: Session) => Session)) => {
    setSessionState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      writeJson(STORAGE_KEY, value.phase === 'idle' ? null : value)
      return value
    })
  }, [])

  // Latest backend instance id, read inside the polling loops below. If it differs from the one the
  // session started under, the backend restarted and its IDs may now belong to someone else's car.
  const instanceRef = useRef(backendInstanceId)
  useEffect(() => {
    instanceRef.current = backendInstanceId
  })
  const restarted = (started: string | null) => !!started && !!instanceRef.current && started !== instanceRef.current

  // ── Request a space ────────────────────────────────────────────────────────
  const requestSpace = useCallback(
    async (kind: ParkingKind, level: number | null = null) => {
      const startedAt = Date.now()
      setSession({ phase: 'submitting', kind, level, startedAt })
      try {
        const { requestId } = await api.requestParking(kind, level)
        // 202 = queued. NOT a success yet; wait for Unity's real outcome.
        setSession({ phase: 'pending', kind, level, requestId, startedAt, forwarded: false, instanceId: backendInstanceId })
      } catch (error) {
        let failureKind: FailureKind = 'other'
        let reason: string | null = 'could not reach the parking system'
        if (error instanceof ApiError) {
          failureKind = error.status === 503 ? 'offline' : 'rejected'
          reason = error.message
        }
        setSession({ phase: 'failed', kind, level, failureKind, reason })
      }
    },
    [setSession, backendInstanceId],
  )

  // ── Pending: poll the spawn request until Unity reports SpawnedInUnity or Failed ──
  const pendingId = session.phase === 'pending' ? session.requestId : null
  useEffect(() => {
    if (!pendingId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let firstNotFoundAt: number | null = null

    const tick = async () => {
      try {
        const result = await api.getSpawnRequest(pendingId, controller.signal)
        if (controller.signal.aborted) return
        firstNotFoundAt = null
        setSession((prev) => {
          if (prev.phase !== 'pending' || prev.requestId !== pendingId) return prev
          if (restarted(prev.instanceId)) {
            return { phase: 'failed', kind: prev.kind, level: prev.level, failureKind: 'cancelled', reason: 'the parking system restarted' }
          }
          if (result.outcome === 'Failed') {
            return { phase: 'failed', kind: prev.kind, level: prev.level, failureKind: result.failureKind ?? 'other', reason: result.failureReason }
          }
          if (result.outcome === 'Succeeded' && result.vehicleId) {
            return {
              phase: 'active',
              kind: prev.kind,
              requestId: pendingId,
              vehicleId: result.vehicleId,
              spaceId: null, // comes from the vehicle record
              stage: 'Unknown',
              startedAt: Date.now(),
              parkedAt: null,
              departure: null,
              instanceId: prev.instanceId,
            }
          }
          return prev.forwarded === result.forwardedToUnity ? prev : { ...prev, forwarded: result.forwardedToUnity }
        })
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof NotFoundError) {
          // The backend no longer knows this request: it was restarted (state is in memory only).
          firstNotFoundAt ??= Date.now()
          if (Date.now() - firstNotFoundAt > UNKNOWN_REQUEST_GIVE_UP_MS) {
            setSession((prev) =>
              prev.phase === 'pending'
                ? { phase: 'failed', kind: prev.kind, level: prev.level, failureKind: 'cancelled', reason: 'the parking system restarted' }
                : prev,
            )
          }
        }
        // Network errors: keep waiting; the connection banner tells the driver.
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, config.pollIntervalMs)
    }
    tick()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [pendingId, setSession])

  // ── Active: follow the vehicle (driving → parking → parked → departing → gone) ──
  const vehicleId = session.phase === 'active' ? session.vehicleId : null
  useEffect(() => {
    if (!vehicleId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const vehicle = await api.getVehicle(vehicleId, controller.signal)
        if (controller.signal.aborted) return
        const now = Date.now()
        setSession((prev) => {
          if (prev.phase !== 'active' || prev.vehicleId !== vehicleId) return prev
          if (restarted(prev.instanceId)) {
            return { phase: 'ended', kind: prev.kind, spaceId: prev.spaceId, reason: 'missing', endedAt: now }
          }
          if (vehicle?.stage === 'Failed') {
            return { phase: 'failed', kind: prev.kind, level: null, failureKind: 'other', reason: vehicle.failureReason }
          }
          if (vehicle === null || vehicle.stage === 'Exited') {
            // Not in Unity's snapshot yet right after spawning: wait a moment before concluding anything.
            if (vehicle === null && prev.stage === 'Unknown' && now - prev.startedAt < VEHICLE_GRACE_MS) return prev
            // Gone after departing = left normally. Gone while parked/driving = reset or restart.
            const left = vehicle?.stage === 'Exited' || prev.stage === 'Departing' || prev.departure?.acknowledged === true
            return { phase: 'ended', kind: prev.kind, spaceId: prev.spaceId, reason: left ? 'exited' : 'missing', endedAt: now }
          }
          return {
            ...prev,
            stage: vehicle.stage,
            spaceId: vehicle.assignedSpaceId ?? prev.spaceId,
            parkedAt: vehicle.stage === 'Parked' ? (prev.parkedAt ?? now) : prev.parkedAt,
          }
        })
      } catch {
        // Network trouble: keep the last known state; the banner shows the connection problem.
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, config.pollIntervalMs)
    }
    tick()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [vehicleId, setSession])

  // ── Departure ──────────────────────────────────────────────────────────────
  const requestDeparture = useCallback(async () => {
    if (session.phase !== 'active' || session.departure) return
    setDepartureError(null)
    const id = session.vehicleId
    setSession((prev) => (prev.phase === 'active' ? { ...prev, departure: { commandId: null, requestedAt: Date.now(), acknowledged: false } } : prev))
    try {
      const { commandId } = await api.requestDeparture(id)
      setSession((prev) => (prev.phase === 'active' && prev.departure ? { ...prev, departure: { ...prev.departure, commandId } } : prev))
    } catch (error) {
      setDepartureError(
        error instanceof ApiError
          ? error.status === 503
            ? 'The garage is offline right now, so your departure was not sent. Please try again in a moment.'
            : `The parking system did not accept the departure: ${error.message}`
          : 'Could not reach the parking system. Please try again.',
      )
      setSession((prev) => (prev.phase === 'active' ? { ...prev, departure: null } : prev))
    }
  }, [session, setSession])

  // Follow the DepartVehicle command until Unity accepts or rejects it.
  const departureCommandId =
    session.phase === 'active' && session.departure && !session.departure.acknowledged ? session.departure.commandId : null
  useEffect(() => {
    if (!departureCommandId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const result = await api.getCommand(departureCommandId, controller.signal)
        if (controller.signal.aborted) return
        if (result.outcome === 'Failed') {
          setDepartureError(
            result.failureKind === 'cancelled'
              ? 'Your departure request was cancelled because the system was reset. Please try again.'
              : `The garage could not start your departure${result.message ? `: ${result.message}` : '.'} Please try again.`,
          )
          setSession((prev) => (prev.phase === 'active' ? { ...prev, departure: null } : prev))
          return
        }
        if (result.outcome === 'Succeeded') {
          setSession((prev) =>
            prev.phase === 'active' && prev.departure ? { ...prev, departure: { ...prev.departure, acknowledged: true } } : prev,
          )
          return
        }
      } catch {
        // Network trouble or unknown command: keep trying; restarts are handled by the instance check.
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, config.pollIntervalMs)
    }
    tick()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [departureCommandId, setSession])

  const reset = useCallback(() => {
    setDepartureError(null)
    setSession({ phase: 'idle' })
  }, [setSession])

  return { session, requestSpace, requestDeparture, departureError, reset }
}
