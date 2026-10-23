// Demo mode: an in-browser stand-in for FastAPI + Unity that answers with the SAME raw JSON shapes
// as the real backend (see Raw* types in contract.ts). The real client and parsers run on top of it,
// so demo mode also exercises the contract code. Enable with ?mock=1 or a scenario (see config.ts).
//
// It mimics the real rules: 202 = queued, not spawned; Unity decides the stall later; failures carry
// Unity-style messages; vehicles disappear (404) once they have left the garage.

import type { MockScenario } from '../config'
import type {
  RawBackendCommand,
  RawCommandAccepted,
  RawErrorCode,
  RawIntegrationStatus,
  RawLevel,
  RawLifecycleState,
  RawParkingSpace,
  RawSpaceType,
  RawVehicle,
  RawVehicleSpawnRequest,
} from './contract'
import type { Transport, TransportResponse } from './httpClient'

const STORAGE_KEY = 'driver-dashboard:mock-state'

// Real stall inventory (Backend/app/services/seed_data.py). IDs are not contiguous.
const LEVEL_NUMBERS: Record<RawLevel, string> = {
  L1: '1-53,58-65,68-71,76-83,86-97,100-102,105-107',
  L2: '1-55,58-68,72-82,85-89,93-103,106-110,113-115',
  L3: '1-27,30-40,44-54,59-69,73-83,86-125',
  L4: '1-27,30-40,44-54,59-69,73-83,86-125',
}
const EV_IDS = new Set(['029', '030', '031', '032', '033', '034', '035', '036'].map((n) => `L2_SPACE_${n}`))
const OUT_OF_SERVICE = new Set(['L1_SPACE_029', 'L1_SPACE_087', 'L1_SPACE_088', 'L1_SPACE_089', 'L4_SPACE_017', 'L4_SPACE_018', 'L4_SPACE_044', 'L4_SPACE_045'])

// Timings (ms)
const ACCEPTED_MS = 600 // until Unity fetches the command (it polls every 0.5 s)
const EXECUTE_MS = 1500 // until Unity acknowledges it
const DRIVE_MS = 6000 // DrivingToStall
const PARK_MS = 3000 // Parking
const DEPART_MS = 2000 // Departing (pulling out)
const EXIT_MS = 4000 // DrivingToExit, then the vehicle is removed

interface MockRequest {
  raw: RawVehicleSpawnRequest
  createdAt: number
}
interface MockVehicle {
  id: string
  requester: string
  kind: RawSpaceType
  spaceId: string
  level: RawLevel | null
  spawnedAt: number
  departAt?: number
}
interface MockCommand {
  raw: RawBackendCommand
  createdAt: number
}
interface MockState {
  seq: number
  cmdSeq: number
  requests: Record<string, MockRequest>
  vehicles: Record<string, MockVehicle>
  commands: Record<string, MockCommand>
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as MockState
  } catch {
    /* storage unavailable */
  }
  return { seq: 0, cmdSeq: 0, requests: {}, vehicles: {}, commands: {} }
}
function save(state: MockState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* demo still works for this page load */
  }
}
export function resetMockState() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Deterministic PRNG so the demo garage looks the same on every load. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function expand(ranges: string): number[] {
  return ranges.split(',').flatMap((part) => {
    const [a, b = a] = part.split('-').map(Number)
    return Array.from({ length: b - a + 1 }, (_, i) => a + i)
  })
}

function baseSpaces(scenario: MockScenario): RawParkingSpace[] {
  const rand = seeded(17)
  const spaces: RawParkingSpace[] = []
  ;(Object.keys(LEVEL_NUMBERS) as RawLevel[]).forEach((level, i) => {
    for (const n of expand(LEVEL_NUMBERS[level])) {
      const id = `${level}_SPACE_${String(n).padStart(3, '0')}`
      const ev = EV_IDS.has(id)
      const space: RawParkingSpace = { space_id: id, level, state: 'Available', space_type: ev ? 'EV' : 'Standard', assigned_vehicle_id: null, reserved_by: null }
      if (OUT_OF_SERVICE.has(id)) space.state = 'OutOfService'
      else if (ev && (scenario === 'evfull' || n <= 33)) space.state = 'Occupied'
      else if (!ev && rand() < 0.42 - i * 0.07) space.state = 'Occupied' // lower levels fill first
      if (space.state === 'Occupied') space.assigned_vehicle_id = 'SIM_BACKGROUND'
      spaces.push(space)
    }
  })
  return spaces
}

function lifecycle(v: MockVehicle, now: number): RawLifecycleState | null {
  if (v.departAt !== undefined && now >= v.departAt) {
    const t = now - v.departAt
    return t < DEPART_MS ? 'Departing' : t < DEPART_MS + EXIT_MS ? 'DrivingToExit' : null
  }
  const t = now - v.spawnedAt
  return t < DRIVE_MS ? 'DrivingToStall' : t < DRIVE_MS + PARK_MS ? 'Parking' : 'Parked'
}

const ok = (body: unknown, status = 200): TransportResponse => ({ status, body })
const fail = (status: number, message: string): TransportResponse => ({ status, body: { success: false, message } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createMockTransport(scenario: MockScenario): Transport {
  const state = load()
  state.commands ??= {}
  state.cmdSeq ??= 0
  const nextCommandId = () => `CMD_${String(++state.cmdSeq).padStart(6, '0')}`
  const stale = scenario === 'stale'

  function spaces(now = Date.now()): RawParkingSpace[] {
    const list = baseSpaces(scenario)
    const byId = new Map(list.map((s) => [s.space_id, s]))
    for (const v of Object.values(state.vehicles)) {
      const s = byId.get(v.spaceId)
      const life = lifecycle(v, now)
      if (!s || !life) continue
      s.assigned_vehicle_id = v.id
      if (life === 'DrivingToStall' || life === 'Parking') {
        s.state = 'Reserved'
        s.reserved_by = v.requester
      } else s.state = 'Occupied'
    }
    return list
  }

  /** "Unity" picks up and executes queued spawns, like Backend/tests/fake_unity.py. */
  function advance(req: MockRequest) {
    const r = req.raw
    if (r.status === 'SpawnedInUnity' || r.status === 'Failed' || scenario === 'slow') return
    const age = Date.now() - req.createdAt
    if (age >= ACCEPTED_MS) Object.assign(r, { status: 'ForwardedToUnity', forwarded_to_unity: true })
    if (age < EXECUTE_MS) return

    let failure: string | null = null
    let code: RawErrorCode | null = null
    const pool = spaces().filter((s) => s.state === 'Available' && s.space_type === r.request_type)
    const onLevel = pool.filter((s) => !r.preferred_level || s.level === r.preferred_level)
    if (scenario === 'draining') failure = 'Manual arrivals are disabled while draining.'
    else if (scenario === 'blocked') [failure, code] = ['Entrance is blocked; try again shortly.', 'EntranceBlocked']
    else if (scenario === 'limit') [failure, code] = ['Vehicle limit reached.', 'VehicleLimitReached']
    else if (r.preferred_level && (scenario === 'levelfull' || !onLevel.length)) [failure, code] = [`${r.preferred_level} is full.`, 'LevelFull']
    else if (!pool.length) [failure, code] = ['No matching available space.', 'GarageFull']
    const chosen = onLevel[Math.floor(Math.random() * onLevel.length)]

    if (failure) {
      Object.assign(r, { status: 'Failed', failure_reason: failure, error_code: code })
    } else {
      state.seq += 1
      const id = `VEH_${String(state.seq).padStart(4, '0')}`
      state.vehicles[id] = { id, requester: `SIM_VEH_${String(state.seq).padStart(4, '0')}`, kind: r.request_type, spaceId: chosen.space_id, level: r.preferred_level, spawnedAt: Date.now() }
      Object.assign(r, { status: 'SpawnedInUnity', spawned_in_unity: true, vehicle_id: id })
    }
    save(state)
  }

  /** "Unity" handles a queued DepartVehicle: accepts it only for a parked car. */
  function advanceCommand(cmd: MockCommand) {
    const c = cmd.raw
    if (c.status !== 'Pending' && c.status !== 'Delivered') return
    const age = Date.now() - cmd.createdAt
    if (age >= ACCEPTED_MS) c.status = 'Delivered'
    if (age < EXECUTE_MS) return
    const v = state.vehicles[c.vehicle_id ?? '']
    if (scenario === 'nodepart') Object.assign(c, { status: 'Failed', result_message: 'Departures are unavailable right now.' })
    else if (!v || lifecycle(v, Date.now()) !== 'Parked') Object.assign(c, { status: 'Failed', result_message: 'Vehicle is not parked.' })
    else {
      v.departAt = Date.now() + 800 // Unity starts the departure shortly after acknowledging
      Object.assign(c, { status: 'Acknowledged', result_message: 'Departure started.' })
    }
    save(state)
  }

  return async (method, path, body) => {
    await wait(60 + Math.random() * 120)
    if (scenario === 'offline') throw new TypeError('Failed to fetch (demo: backend offline)')

    if (method === 'GET' && path === '/api/integration/status') {
      const status: RawIntegrationStatus = {
        connected: !stale,
        unity_session_id: 'demo-session',
        latest_sequence: Math.floor(Date.now() / 1000) % 100000,
        last_update_at: new Date(Date.now() - (stale ? 14200 : 400)).toISOString(),
        seconds_since_last_update: stale ? 14.2 : 0.4,
        timeout_seconds: 5,
        data_source: stale ? 'UnityLastKnown' : 'UnityLive',
        pending_commands: Object.values(state.requests).filter((r) => !['SpawnedInUnity', 'Failed'].includes(r.raw.status)).length,
        backend_instance_id: 'demo',
      }
      return ok(status)
    }

    if (method === 'GET' && path === '/api/spaces') return ok(spaces())

    if (method === 'POST' && path === '/api/vehicles/spawn') {
      const b = (body ?? {}) as Record<string, unknown>
      const extra = Object.keys(b).filter((k) => !['request_type', 'preferred_level', 'auto_depart'].includes(k))
      if (!['Standard', 'EV'].includes(b.request_type as string) || extra.length) {
        return ok({ detail: [{ msg: 'Invalid spawn body', input: b }] }, 422)
      }
      if (stale) return fail(503, 'Unity is not connected; the spawn request was not created.')
      const n = Object.keys(state.requests).length + 1
      const raw: RawVehicleSpawnRequest = {
        request_id: `REQ_${String(n).padStart(4, '0')}`,
        request_type: b.request_type as RawSpaceType,
        preferred_level: (b.preferred_level as RawLevel | undefined) ?? null,
        auto_depart: (b.auto_depart as boolean | undefined) ?? true,
        status: 'AcceptedByBackend',
        forwarded_to_unity: false,
        spawned_in_unity: false,
        vehicle_id: null,
        command_id: nextCommandId(),
        failure_reason: null,
        error_code: null,
      }
      state.requests[raw.request_id] = { raw, createdAt: Date.now() }
      save(state)
      const accepted: RawCommandAccepted = {
        success: true,
        message: 'Spawn queued for Unity. It has not been executed yet.',
        current_state: 'Running',
        command: { command_id: raw.command_id!, command_type: 'SpawnVehicle', status: 'Pending', result_message: null, vehicle_id: null, error_code: null },
        request: { ...raw },
      }
      return ok(accepted, 202)
    }

    let m = /^\/api\/vehicles\/spawn-requests\/([^/]+)$/.exec(path)
    if (method === 'GET' && m) {
      const req = state.requests[decodeURIComponent(m[1])]
      if (!req) return fail(404, `Spawn request '${m[1]}' does not exist.`)
      advance(req)
      return ok({ ...req.raw })
    }

    m = /^\/api\/vehicles\/([^/]+)\/depart$/.exec(path)
    if (method === 'POST' && m) {
      if (stale) return fail(503, 'Unity is not connected; the command was not queued.')
      // Like the real backend: queues the command for any id; Unity decides whether it is valid.
      const raw: RawBackendCommand = { command_id: nextCommandId(), command_type: 'DepartVehicle', status: 'Pending', result_message: null, vehicle_id: decodeURIComponent(m[1]), error_code: null }
      state.commands[raw.command_id] = { raw, createdAt: Date.now() }
      save(state)
      const accepted: RawCommandAccepted = { success: true, message: 'Departure queued for Unity. It has not been executed yet.', current_state: 'Running', command: { ...raw }, request: null }
      return ok(accepted, 202)
    }

    m = /^\/api\/integration\/commands\/([^/]+)$/.exec(path)
    if (method === 'GET' && m) {
      const cmd = state.commands[decodeURIComponent(m[1])]
      if (!cmd) return fail(404, `Command '${m[1]}' does not exist.`)
      advanceCommand(cmd)
      return ok({ ...cmd.raw })
    }

    m = /^\/api\/vehicles\/([^/]+)$/.exec(path)
    if (method === 'GET' && m) {
      const v = state.vehicles[decodeURIComponent(m[1])]
      const life = v ? lifecycle(v, Date.now()) : null
      if (!v || !life) return fail(404, `Vehicle '${m[1]}' does not exist.`)
      const raw: RawVehicle = { vehicle_id: v.id, requester_id: v.requester, request_type: v.kind, lifecycle_state: life, assigned_space_id: v.spaceId, preferred_level: v.level, failure_reason: null }
      return ok(raw)
    }

    return fail(404, 'Not Found')
  }
}
