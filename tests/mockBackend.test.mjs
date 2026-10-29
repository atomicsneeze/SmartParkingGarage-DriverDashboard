// The demo backend (?mock=…) must follow the same rules as the real FastAPI backend,
// otherwise demo mode would hide bugs. These tests drive it through raw HTTP-shaped calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMockTransport } from '../src/api/mockBackend.ts'

const signal = new AbortController().signal

async function park(t, scenario, body = { request_type: 'Standard', auto_depart: false }) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const call = createMockTransport(scenario)
  const accepted = await call('POST', '/api/vehicles/spawn', body, signal)
  return { call, accepted, requestId: accepted.body?.request?.request_id }
}

test('spawn rejects fields the real backend forbids (422)', async (t) => {
  const { accepted } = await park(t, 'normal', { request_type: 'Standard', client_request_id: 'x' })
  assert.equal(accepted.status, 422)
})

test('202 means queued; the car appears only after "Unity" confirms', async (t) => {
  const { call, accepted, requestId } = await park(t, 'normal')
  assert.equal(accepted.status, 202)
  assert.equal(accepted.body.request.status, 'AcceptedByBackend')
  t.mock.timers.tick(700)
  assert.equal((await call('GET', `/api/vehicles/spawn-requests/${requestId}`, undefined, signal)).body.status, 'ForwardedToUnity')
  t.mock.timers.tick(1000)
  const done = (await call('GET', `/api/vehicles/spawn-requests/${requestId}`, undefined, signal)).body
  assert.equal(done.status, 'SpawnedInUnity')
  const vehicle = (await call('GET', `/api/vehicles/${done.vehicle_id}`, undefined, signal)).body
  assert.equal(vehicle.lifecycle_state, 'DrivingToStall')
  assert.ok(vehicle.assigned_space_id)
})

test('departure: accepted only for a parked car, then the car leaves and disappears', async (t) => {
  const { call, requestId } = await park(t, 'normal')
  t.mock.timers.tick(1600)
  const vehicleId = (await call('GET', `/api/vehicles/spawn-requests/${requestId}`, undefined, signal)).body.vehicle_id

  const early = await call('POST', `/api/vehicles/${vehicleId}/depart`, undefined, signal)
  assert.equal(early.status, 202, 'queued even while driving; Unity decides')
  t.mock.timers.tick(1600)
  const refused = (await call('GET', `/api/integration/commands/${early.body.command.command_id}`, undefined, signal)).body
  assert.equal(refused.status, 'Failed')

  t.mock.timers.tick(10_000) // now parked
  assert.equal((await call('GET', `/api/vehicles/${vehicleId}`, undefined, signal)).body.lifecycle_state, 'Parked')
  const depart = await call('POST', `/api/vehicles/${vehicleId}/depart`, undefined, signal)
  t.mock.timers.tick(1600)
  assert.equal((await call('GET', `/api/integration/commands/${depart.body.command.command_id}`, undefined, signal)).body.status, 'Acknowledged')
  t.mock.timers.tick(1000)
  assert.equal((await call('GET', `/api/vehicles/${vehicleId}`, undefined, signal)).body.lifecycle_state, 'Departing')
  t.mock.timers.tick(10_000)
  assert.equal((await call('GET', `/api/vehicles/${vehicleId}`, undefined, signal)).status, 404)
})

test('failure scenarios carry the real error codes', async (t) => {
  const cases = [
    ['blocked', { request_type: 'Standard' }, 'EntranceBlocked'],
    ['limit', { request_type: 'Standard' }, 'VehicleLimitReached'],
    ['levelfull', { request_type: 'Standard', preferred_level: 'L3' }, 'LevelFull'],
    ['evfull', { request_type: 'EV' }, 'GarageFull'],
  ]
  for (const [scenario, body, code] of cases) {
    await t.test(scenario, async (t) => {
      const { call, requestId } = await park(t, scenario, { ...body, auto_depart: false })
      t.mock.timers.tick(1600)
      const r = (await call('GET', `/api/vehicles/spawn-requests/${requestId}`, undefined, signal)).body
      assert.equal(r.status, 'Failed')
      assert.equal(r.error_code, code)
      assert.equal(r.vehicle_id, null, 'no ghost vehicle')
    })
  }
})

test('restart before Unity answers → OutcomeUnknown, with no vehicle and no error', async (t) => {
  const { call, requestId } = await park(t, 'unknown')
  t.mock.timers.tick(1600)
  const r = (await call('GET', `/api/vehicles/spawn-requests/${requestId}`, undefined, signal)).body
  assert.equal(r.status, 'OutcomeUnknown')
  assert.equal(r.forwarded_to_unity, true)
  assert.equal(r.vehicle_id, null)
  assert.equal(r.error_code, null)
})

test('Unity offline: spawn returns 503 and queues nothing', async (t) => {
  const { accepted } = await park(t, 'stale')
  assert.equal(accepted.status, 503)
})
