import test from 'node:test'
import assert from 'node:assert/strict'
import { availableFor, summarize } from '../src/lib/availability.ts'
import { describeSpace, failureCopy } from '../src/lib/driverCopy.ts'

const space = (id, level, status, kind = 'Standard') => ({ id, level, number: Number(id.slice(-3)), status, kind })

test('driver availability counts', () => {
  const a = summarize([
    space('L1_SPACE_001', 1, 'Available'),
    space('L1_SPACE_002', 1, 'Reserved'), // another car is heading there: not open
    space('L1_SPACE_029', 1, 'OutOfService'), // never counted as capacity
    space('L2_SPACE_029', 2, 'Available', 'EV'),
    space('L2_SPACE_030', 2, 'Occupied', 'EV'),
    space('L2_SPACE_001', 2, 'Occupied'),
  ])
  assert.equal(a.totalAvailable, 2)
  assert.equal(a.totalOperational, 5)
  assert.equal(availableFor(a, 'Standard'), 1)
  assert.equal(availableFor(a, 'EV'), 1)
  assert.equal(a.evOperational, 2)
  assert.deepEqual(a.levels.map((l) => [l.level, l.available, l.operational, l.evAvailable]), [[1, 1, 2, 0], [2, 1, 3, 1]])
})

test('stall ids read as driver-friendly locations', () => {
  assert.equal(describeSpace('L2_SPACE_031').full, 'Level 2 · Space 31')
  assert.equal(describeSpace(null), null)
})

test('every failure type has its own driver message', () => {
  const kinds = ['capacity', 'levelFull', 'vehicleLimit', 'closed', 'temporary', 'cancelled', 'unknown', 'offline', 'rejected', 'other']
  const titles = kinds.map((k) => failureCopy(k, 'Standard', null).title)
  assert.equal(new Set(titles).size, kinds.length)
  assert.match(failureCopy('capacity', 'EV', null).title, /EV/)
})
