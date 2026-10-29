// Contract tests: raw backend JSON (shapes from Backend/src/smart_parking_backend/models) → app types.
// Run with `npm test` (Node's built-in test runner, same as the Operator Dashboard's tests/).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyFailure,
  errorMessage,
  parseCommand,
  parseIntegrationStatus,
  parseSpace,
  parseSpawnAccepted,
  parseSpawnRequest,
  parseVehicle,
  toSpawnBody,
} from '../src/api/contract.ts'

const request = (fields) => ({
  request_id: 'REQ_0001',
  request_type: 'Standard',
  preferred_level: null,
  auto_depart: false,
  status: 'AcceptedByBackend',
  forwarded_to_unity: false,
  spawned_in_unity: false,
  vehicle_id: null,
  command_id: 'CMD_000001',
  failure_reason: null,
  error_code: null,
  ...fields,
})
const command = (fields) => ({ command_id: 'CMD_000002', command_type: 'DepartVehicle', status: 'Pending', result_message: null, vehicle_id: null, error_code: null, ...fields })

test('spawn body: driver cars wait for the driver, and no extra fields (backend forbids them)', () => {
  assert.deepEqual(toSpawnBody('Standard', null), { request_type: 'Standard', auto_depart: false })
  assert.deepEqual(toSpawnBody('Standard', 3), { request_type: 'Standard', auto_depart: false, preferred_level: 'L3' })
  assert.deepEqual(toSpawnBody('EV', null), { request_type: 'EV', auto_depart: false })
})

test('spawn accepted (202) gives the request id, not a success', () => {
  const body = { success: true, message: 'queued', current_state: 'Running', command: command({ command_type: 'SpawnVehicle' }), request: request() }
  assert.deepEqual(parseSpawnAccepted(body), { requestId: 'REQ_0001' })
})

test('spawn request statuses', async (t) => {
  await t.test('queued and forwarded are still pending', () => {
    assert.equal(parseSpawnRequest(request()).outcome, 'Pending')
    const forwarded = parseSpawnRequest(request({ status: 'ForwardedToUnity', forwarded_to_unity: true }))
    assert.equal(forwarded.outcome, 'Pending')
    assert.equal(forwarded.forwardedToUnity, true)
  })
  await t.test('only SpawnedInUnity is a success, and it carries the vehicle id', () => {
    const ok = parseSpawnRequest(request({ status: 'SpawnedInUnity', spawned_in_unity: true, forwarded_to_unity: true, vehicle_id: 'VEH_0007' }))
    assert.equal(ok.outcome, 'Succeeded')
    assert.equal(ok.vehicleId, 'VEH_0007')
  })
  await t.test('each Unity error code maps to its own driver message type', () => {
    const kinds = { GarageFull: 'capacity', LevelFull: 'levelFull', VehicleLimitReached: 'vehicleLimit', EntranceBlocked: 'temporary' }
    for (const [code, kind] of Object.entries(kinds)) {
      assert.equal(parseSpawnRequest(request({ status: 'Failed', error_code: code, failure_reason: 'x' })).failureKind, kind, code)
    }
  })
  await t.test('OutcomeUnknown is not a failure: a car may or may not exist', () => {
    const unknown = parseSpawnRequest(request({ status: 'OutcomeUnknown', forwarded_to_unity: true }))
    assert.equal(unknown.outcome, 'Unknown')
    assert.equal(unknown.failureKind, null)
    assert.equal(unknown.vehicleId, null)
  })
})

test('failure messages without a code fall back to the wording', () => {
  assert.equal(classifyFailure(null, 'No matching available space.'), 'capacity')
  assert.equal(classifyFailure(null, 'Manual arrivals are disabled while draining.'), 'closed')
  assert.equal(classifyFailure(null, 'Obsolete: superseded by reset CMD_000009.'), 'cancelled')
  assert.equal(classifyFailure(null, 'Something new'), 'other')
  assert.equal(classifyFailure('LevelFull', 'No matching available space.'), 'levelFull', 'code wins over text')
})

test('departure command statuses', () => {
  assert.equal(parseCommand(command()).outcome, 'Pending')
  assert.equal(parseCommand(command({ status: 'Delivered' })).outcome, 'Pending')
  assert.equal(parseCommand(command({ status: 'Acknowledged', result_message: 'Departure started.' })).outcome, 'Succeeded')
  const refused = parseCommand(command({ status: 'Failed', result_message: 'Vehicle VEH_0001 is not parked.' }))
  assert.equal(refused.outcome, 'Failed')
  assert.equal(refused.message, 'Vehicle VEH_0001 is not parked.')
  assert.equal(parseCommand(command({ status: 'Cancelled' })).failureKind, 'cancelled')
  const unknown = parseCommand(command({ status: 'OutcomeUnknown' }))
  assert.equal(unknown.outcome, 'Unknown')
  assert.equal(unknown.failureKind, null)
})

test('vehicle lifecycle states map to driver stages', () => {
  const expected = {
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
  for (const [state, stage] of Object.entries(expected)) {
    const v = parseVehicle({ vehicle_id: 'VEH_0001', requester_id: 'SIM_VEH_0001', request_type: 'EV', lifecycle_state: state, assigned_space_id: 'L2_SPACE_031', preferred_level: null, failure_reason: null })
    assert.equal(v.stage, stage, state)
    assert.equal(v.assignedSpaceId, 'L2_SPACE_031')
  }
})

test('spaces: "L3" level strings and stall numbers', () => {
  const s = parseSpace({ space_id: 'L3_SPACE_118', level: 'L3', state: 'OutOfService', space_type: 'Standard', assigned_vehicle_id: null, reserved_by: null })
  assert.deepEqual(s, { id: 'L3_SPACE_118', level: 3, number: 118, status: 'OutOfService', kind: 'Standard' })
})

test('integration status: only connected + UnityLive counts as live', () => {
  const base = { connected: true, unity_session_id: 's', latest_sequence: 3, last_update_at: null, seconds_since_last_update: 0.4, timeout_seconds: 5, data_source: 'UnityLive', pending_commands: 0, backend_instance_id: 'abc' }
  assert.equal(parseIntegrationStatus(base).live, true)
  assert.equal(parseIntegrationStatus({ ...base, data_source: 'UnityLastKnown' }).live, false)
  assert.equal(parseIntegrationStatus({ ...base, data_source: 'SeededBaseline', connected: false }).live, false)
})

test('error bodies: service errors use message, validation errors use detail', () => {
  assert.equal(errorMessage({ success: false, message: 'Unity is not connected; the command was not queued.' }, 'x'), 'Unity is not connected; the command was not queued.')
  assert.equal(errorMessage({ detail: [{ type: 'extra_forbidden' }] }, 'x'), 'The request was not in the format the backend expects.')
  assert.equal(errorMessage(null, 'HTTP 500'), 'HTTP 500')
})
