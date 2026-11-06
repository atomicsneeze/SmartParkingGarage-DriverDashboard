// Automated acceptance run for the Driver Dashboard (docs/ACCEPTANCE_TESTS.md, Env B).
//
// Drives a real browser through each DD-xx scenario against the real FastAPI backend (PostgreSQL) and the
// simulated Unity client (tools/fake_unity_loop.py), then writes docs/acceptance-results.md.
//
// One-time setup:   npx playwright install chromium
// Run (4 terminals): backend · fake Unity (with a control file) · `npm run dev` · then:
//   CONTROL_FILE=<same json file the fake Unity loop reads> npm run acceptance
// Optional, enables DD-03 / DD-17 / DD-18 (they need to stop and start the backend):
//   BACKEND_STOP_CMD="<command that stops the backend>"  BACKEND_START_CMD="<command that starts it>"
// Optional: DASHBOARD_URL (default http://localhost:5174), BACKEND_URL (default http://127.0.0.1:8000),
//           BROWSER_PATH (a Chromium executable, if Playwright's own is not installed).

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const DASHBOARD = process.env.DASHBOARD_URL ?? 'http://localhost:5174'
const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'
const CONTROL = process.env.CONTROL_FILE
const STOP_CMD = process.env.BACKEND_STOP_CMD
const START_CMD = process.env.BACKEND_START_CMD
const RESULTS_FILE = path.join(import.meta.dirname, '..', 'docs', 'acceptance-results.md')

// ── helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (p, init) => {
  const res = await fetch(BACKEND + p, init)
  return { status: res.status, body: await res.json().catch(() => null) }
}
const control = (flags = {}) => CONTROL && fs.writeFileSync(CONTROL, JSON.stringify(flags))

class Failure extends Error {}
function expect(condition, message) {
  if (!condition) throw new Failure(message)
}

/** Polls until fn() returns a truthy value, or fails with `message`. */
async function waitFor(fn, message, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs
  let last
  while (Date.now() < end) {
    try {
      last = await fn()
      if (last) return last
    } catch {
      /* element not there yet */
    }
    await sleep(250)
  }
  throw new Failure(message)
}

async function waitForBackend(up, timeoutMs = 30000) {
  await waitFor(async () => {
    try {
      return up === ((await fetch(BACKEND + '/health')).status === 200)
    } catch {
      return !up
    }
  }, `backend did not ${up ? 'start' : 'stop'}`, timeoutMs)
}

const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {})
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e)))
let spawnPosts = 0
page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/vehicles/spawn') && spawnPosts++)

const text = async (selector) => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ').trim()
const pill = () => text('.pill')
const button = (name) => page.getByRole('button', { name })
const session = () => page.evaluate(() => JSON.parse(localStorage.getItem('driver-dashboard:session') ?? 'null'))

async function freshDashboard() {
  // Clear the saved journey from a same-origin page that does not run the app; a running dashboard
  // would write its session straight back.
  await page.goto(`${DASHBOARD}/favicon.svg`)
  await page.evaluate(() => localStorage.removeItem('driver-dashboard:session'))
  await page.goto(DASHBOARD)
  await waitFor(async () => (await pill()) === 'Live', 'dashboard did not show Live', 20000)
}

async function request({ kind = 'Standard', level = null } = {}) {
  if (kind === 'EV') await page.getByRole('radio', { name: /EV charging/ }).click()
  if (level) await page.getByRole('button', { name: new RegExp(`^Level ${level},`) }).click()
  await button('Find me a space').click()
}

async function waitParked() {
  await waitFor(async () => (await text('#assigned-title')) === 'You are parked', 'car never showed "You are parked"', 25000)
  return session()
}

const alertTitle = () => text('[role=alert] .card__title')
const vehicleCount = async () => (await api('/api/vehicles')).body.length

// ── scenarios ────────────────────────────────────────────────────────────────

const results = []
async function scenario(id, title, run, { needs = [] } = {}) {
  const missing = needs.filter((n) => (n === 'control' ? !CONTROL : !(STOP_CMD && START_CMD)))
  if (missing.length) {
    results.push({ id, title, result: 'SKIP', detail: `needs ${missing.includes('control') ? 'CONTROL_FILE' : 'BACKEND_STOP_CMD/BACKEND_START_CMD'}`, ms: 0 })
    console.log(`SKIP  ${id} ${title}`)
    return
  }
  control({})
  const started = Date.now()
  const errorsBefore = jsErrors.length
  try {
    const detail = (await run()) ?? ''
    expect(jsErrors.length === errorsBefore, `JavaScript error: ${jsErrors.slice(errorsBefore).join('; ')}`)
    results.push({ id, title, result: 'PASS', detail, ms: Date.now() - started })
    console.log(`PASS  ${id} ${title}${detail ? ' — ' + detail : ''}`)
  } catch (error) {
    const detail = error instanceof Failure ? error.message : String(error).split('\n')[0]
    results.push({ id, title, result: 'FAIL', detail, ms: Date.now() - started })
    console.log(`FAIL  ${id} ${title} — ${detail}`)
    await page.screenshot({ path: path.join(import.meta.dirname, `acceptance-${id}.png`), fullPage: true }).catch(() => {})
  } finally {
    control({})
  }
}

await scenario('DD-01', 'Live availability matches the garage and the Operator Dashboard', async () => {
  await freshDashboard()
  const garage = (await api('/api/garage')).body
  const spaces = (await api('/api/spaces')).body
  const shown = Number((await text('.hero-number')).split(' ')[0])
  expect(shown === garage.available, `open ${shown} ≠ /api/garage available ${garage.available}`)
  const inService = Number((await text('.card__meta')).match(/\d+/)[0])
  expect(inService === garage.operational_spaces, `in service ${inService} ≠ operational ${garage.operational_spaces}`)
  const rows = await page.locator('.levels__row').allInnerTexts()
  for (const level of garage.levels) {
    const row = rows.find((r) => r.startsWith(level.level))
    expect(row && Number(row.match(/(\d+)\s*open/)[1]) === level.available, `${level.level} shows "${row}" but /api/garage says ${level.available}`)
  }
  const ev = spaces.filter((s) => s.space_type === 'EV')
  const evOpen = ev.filter((s) => s.state === 'Available').length
  expect((await text('.split')).includes(`${evOpen} / ${ev.length}`), `EV split should read ${evOpen} / ${ev.length}`)
  return `${shown} open of ${inService}; levels ${garage.levels.map((l) => l.available).join('/')}; EV ${evOpen}/${ev.length}`
})

await scenario('DD-02', 'Unity stops reporting → Garage offline, requests paused, recovers', async () => {
  await freshDashboard()
  control({ stop: true })
  await waitFor(async () => (await pill()) === 'Garage offline', 'pill never showed "Garage offline"', 12000)
  expect(await page.locator('.banner').count(), 'no warning banner')
  expect(await button('Find me a space').isDisabled(), 'request button still enabled while offline')
  expect((await text('.content')).includes('Requests are paused'), 'no "requests are paused" hint')
  control({})
  await waitFor(async () => (await pill()) === 'Live', 'did not return to Live after Unity resumed', 12000)
  return 'offline shown, button disabled, back to Live without reload'
}, { needs: ['control'] })

await scenario('DD-12', 'Request while Unity offline is not possible', async () => {
  await freshDashboard()
  const before = spawnPosts
  control({ stop: true })
  await waitFor(async () => (await pill()) === 'Garage offline', 'pill never showed "Garage offline"', 12000)
  await button('Find me a space').click({ force: true, timeout: 2000 }).catch(() => {})
  await sleep(1000)
  expect(spawnPosts === before, 'a spawn request was sent while offline')
  return 'button disabled; nothing sent'
}, { needs: ['control'] })

let parkedCar = null
await scenario('DD-04', 'Standard request, no preference: pending → assigned → parked', async () => {
  await freshDashboard()
  await request()
  await waitFor(async () => (await text('#pending-title')).startsWith('Finding you a space'), '202 was not shown as pending', 3000)
  await waitFor(() => page.locator('.space-hero').count(), 'no assigned stall shown', 15000)
  const s = await waitParked()
  const vehicle = (await api(`/api/vehicles/${s.vehicleId}`)).body
  const shown = await text('.space-hero')
  const [, lvl, num] = vehicle.assigned_space_id.match(/^L(\d)_SPACE_0*(\d+)$/)
  expect(shown.startsWith(`Level ${lvl} Space ${num}`), `shows "${shown}" but vehicle is in ${vehicle.assigned_space_id}`)
  const stall = (await api('/api/spaces')).body.find((x) => x.space_id === vehicle.assigned_space_id)
  expect(stall.state === 'Occupied', `stall state is ${stall.state}, expected Occupied`)
  parkedCar = { id: s.vehicleId, space: vehicle.assigned_space_id }
  return `${s.vehicleId} parked in ${vehicle.assigned_space_id} (Occupied in /api/spaces)`
})

await scenario('DD-13', 'Refresh during a journey does not create a second car', async () => {
  await freshDashboard()
  const before = spawnPosts
  const carsBefore = await vehicleCount()
  await request()
  await waitFor(() => page.locator('.space-hero').count(), 'no assigned stall shown', 15000)
  const shown = await text('.space-hero')
  await page.reload()
  await waitFor(async () => (await text('.space-hero')) === shown, 'stall changed or vanished after reload', 8000)
  await waitParked()
  expect(spawnPosts - before === 1, `${spawnPosts - before} spawn requests sent`)
  expect((await vehicleCount()) - carsBefore === 1, 'more than one car was created')
  return `1 spawn request, same stall (${shown}) after reload`
})

await scenario('DD-14', 'Find My Car', async () => {
  expect(parkedCar, 'needs DD-04')
  await freshDashboard()
  await request()
  const s = await waitParked()
  await button('Open My car').click()
  const space = (await api(`/api/vehicles/${s.vehicleId}`)).body.assigned_space_id
  const [, lvl, num] = space.match(/^L(\d)_SPACE_0*(\d+)$/)
  expect((await text('#mycar-title')) === 'Your car is parked at', 'missing "Your car is parked at"')
  expect((await text('.space-hero')).startsWith(`Level ${lvl} Space ${num}`), 'wrong level/space')
  expect((await text('.facts')).includes('Parked'), 'no parked time')
  expect((await text('.stack__floor--mine')).startsWith(`Level ${lvl}`), 'wrong floor highlighted')
  return `Level ${lvl} · Space ${num}, floor highlighted`
})

await scenario('DD-15', 'Driver car stays parked (auto_depart: false), then departs and frees the stall', async () => {
  const s = await session()
  expect(s?.phase === 'active', 'needs DD-14')
  const space = (await api(`/api/vehicles/${s.vehicleId}`)).body.assigned_space_id
  await sleep(30000) // simulated background cars leave on their own after ~27 s
  expect((await text('.facts')).includes('You are parked'), 'car did not stay parked')
  const openBefore = (await api('/api/garage')).body.available
  await button(/Request departure/).click()
  await waitFor(async () => (await text('#depart-title + *')).includes('Departure'), 'no "departure requested" state', 3000)
  await waitFor(async () => (await text('#depart-title + *')).includes('Heading to the exit'), 'never showed "Heading to the exit"', 10000)
  await waitFor(async () => (await text('.card__title')) === 'You have left the garage', 'never showed "You have left"', 15000)
  const stall = (await api('/api/spaces')).body.find((x) => x.space_id === space)
  expect(stall.state === 'Available', `stall ${space} is ${stall.state} after leaving`)
  const openAfter = (await api('/api/garage')).body.available
  expect(openAfter >= openBefore + 1, `open count ${openBefore} → ${openAfter}`)
  return `stayed 30 s, left, ${space} Available again (${openBefore} → ${openAfter} open)`
})

await scenario('DD-05', 'Standard request with preferred level L2', async () => {
  await freshDashboard()
  await request({ level: 2 })
  await waitFor(() => page.locator('.space-hero').count(), 'no assigned stall shown', 15000)
  const s = await session()
  const space = (await api(`/api/vehicles/${s.vehicleId}`)).body.assigned_space_id
  expect(space.startsWith('L2_'), `assigned ${space}`)
  return space
})

await scenario('DD-06', 'EV request gets an L2 EV stall', async () => {
  await freshDashboard()
  await request({ kind: 'EV' })
  await waitFor(() => page.locator('.space-hero').count(), 'no assigned stall shown', 15000)
  const s = await session()
  const space = (await api(`/api/vehicles/${s.vehicleId}`)).body.assigned_space_id
  const n = Number(space.slice(-3))
  expect(space.startsWith('L2_') && n >= 29 && n <= 36, `assigned ${space}, not an EV stall`)
  expect((await text('.space-hero')).includes('EV charging'), 'no EV tag')
  return space
})

for (const [id, title, flags, req, expected, extra] of [
  ['DD-07', 'EV full (GarageFull)', { garage_full: true }, { kind: 'EV' }, 'No EV charging spaces open', 'Request a standard space'],
  ['DD-08', 'Preferred level full (LevelFull)', { level_full: true }, { level: 3 }, 'That level is full', 'Try any level'],
  ['DD-09', 'Vehicle limit (VehicleLimitReached)', { limit: true }, {}, 'Garage is at its vehicle limit', 'Try again'],
  ['DD-10', 'Entrance blocked (EntranceBlocked)', { blocked: true }, {}, 'Entrance is busy', 'Try again'],
]) {
  await scenario(id, title, async () => {
    await freshDashboard()
    const cars = await vehicleCount()
    control(flags)
    await request(req)
    await waitFor(async () => (await alertTitle()) === expected, `expected "${expected}"`, 10000)
    const buttons = await page.locator('[role=alert] button').allInnerTexts()
    expect(buttons.includes(extra), `missing "${extra}" button (has ${buttons.join(', ')})`)
    expect((await vehicleCount()) === cars, 'a vehicle was created')
    if (id === 'DD-10') expect(await page.locator('.card--accent-amber[role=alert]').count(), 'not shown as a soft (amber) warning')
    if (id === 'DD-08') {
      control({})
      await button('Try any level').click()
      await waitFor(() => page.locator('.space-hero').count(), '"Try any level" did not get a stall', 15000)
    }
    return `"${expected}" + ${extra}${id === 'DD-08' ? ' → parked on any level' : ''}`
  }, { needs: ['control'] })
}

await scenario('DD-16', 'Departure only offered when parked', async () => {
  await freshDashboard()
  await request()
  await waitFor(() => page.locator('.space-hero').count(), 'no assigned stall shown', 15000)
  await page.getByRole('button', { name: 'My car' }).click()
  expect(await button(/Request departure/).isDisabled(), 'departure enabled while still driving')
  expect((await text('.content')).includes('Available once you are parked'), 'no explanation shown')
  await page.getByRole('button', { name: 'Park' }).click()
  await waitParked()
  return 'disabled with explanation until parked'
})

await scenario('DD-11', 'Garage draining → not accepting arrivals', async () => {
  await freshDashboard() // a driver car from DD-16 is still parked, so the garage stays in Draining
  const drain = await api('/api/simulation/drain', { method: 'POST' })
  expect(drain.status === 202, `drain returned ${drain.status}`)
  await sleep(2000)
  await request()
  await waitFor(async () => (await alertTitle()) === 'Garage is not accepting arrivals', 'expected "Garage is not accepting arrivals"', 10000)
  // Restore a running simulation for the following scenarios.
  await api('/api/simulation/reset', { method: 'POST' })
  await sleep(2000)
  await api('/api/simulation/start', { method: 'POST' })
  await sleep(2000)
  return 'refused while draining; simulation reset and restarted afterwards'
})

await scenario('DD-17', 'Backend restart while parked: same car tracked, departure still works', async () => {
  await freshDashboard()
  await request()
  const s = await waitParked()
  const shown = await text('.space-hero')
  const before = (await api('/api/integration/status')).body.backend_instance_id
  execSync(STOP_CMD, { stdio: 'ignore', shell: true })
  await waitForBackend(false)
  await waitFor(async () => ['No connection', 'Garage offline'].includes(await pill()), 'no connection warning during restart', 10000)
  execSync(START_CMD, { stdio: 'ignore', shell: true })
  await waitForBackend(true)
  await waitFor(async () => (await pill()) === 'Live', 'did not return to Live after restart', 30000)
  const after = (await api('/api/integration/status')).body.backend_instance_id
  expect(before !== after, 'backend did not actually restart')
  expect((await text('.space-hero')) === shown && (await session()).vehicleId === s.vehicleId, 'tracking changed after restart')
  await button('Open My car').click()
  await button(/Request departure/).click()
  await waitFor(async () => (await text('.card__title')) === 'You have left the garage', 'departure after restart did not complete', 20000)
  return `${s.vehicleId} tracked across restart (${before} → ${after}); departed`
}, { needs: ['control', 'restart'] })

await scenario('DD-18', 'Backend restart before Unity answers → OutcomeUnknown', async () => {
  await freshDashboard()
  control({ hold: true })
  await request()
  await waitFor(async () => (await text('.content')).includes('The garage is choosing your'), 'request never reached Unity', 10000)
  execSync(STOP_CMD, { stdio: 'ignore', shell: true })
  await waitForBackend(false)
  execSync(START_CMD, { stdio: 'ignore', shell: true })
  await waitForBackend(true)
  control({})
  await waitFor(async () => (await alertTitle()) === 'We could not confirm your request', 'expected "We could not confirm your request"', 30000)
  const last = (await api('/api/vehicles/spawn-requests')).body.at(-1)
  expect(last.status === 'OutcomeUnknown', `backend says ${last.status}`)
  return `${last.request_id} OutcomeUnknown, shown honestly`
}, { needs: ['control', 'restart'] })

await scenario('DD-03', 'Backend unreachable → No connection, recovers', async () => {
  await freshDashboard()
  execSync(STOP_CMD, { stdio: 'ignore', shell: true })
  await waitForBackend(false)
  await waitFor(async () => (await pill()) === 'No connection', 'pill never showed "No connection"', 10000)
  expect((await text('.banner')).includes('Last update'), 'banner does not give the last update time')
  expect(await page.locator('.hero-number').count(), 'numbers disappeared')
  execSync(START_CMD, { stdio: 'ignore', shell: true })
  await waitForBackend(true)
  await waitFor(async () => (await pill()) === 'Live', 'did not recover after backend returned', 30000)
  return 'warning with last update time; numbers kept; recovered'
}, { needs: ['restart'] })

await browser.close()

// ── report ───────────────────────────────────────────────────────────────────

const order = (id) => Number(id.slice(3))
results.sort((a, b) => order(a.id) - order(b.id))
const counts = Object.fromEntries(['PASS', 'FAIL', 'SKIP'].map((r) => [r, results.filter((x) => x.result === r).length]))
const icon = { PASS: '✅', FAIL: '❌', SKIP: '—' }
const report = [
  '# Driver Dashboard — Acceptance Run (Env B)',
  '',
  `Generated by \`tools/acceptance.mjs\` on ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC against \`${BACKEND}\`` +
    ' (real FastAPI backend with PostgreSQL) and the simulated Unity client. Scenario definitions: ' +
    '[ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md).',
  '',
  `**${counts.PASS} passed · ${counts.FAIL} failed · ${counts.SKIP} skipped**`,
  '',
  '| Scenario | Result | Observed | Time |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.id} ${r.title} | ${icon[r.result]} ${r.result} | ${r.detail.replace(/\|/g, '\\|')} | ${(r.ms / 1000).toFixed(1)} s |`),
  '',
]
fs.writeFileSync(RESULTS_FILE, report.join('\n'))
console.log(`\n${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped → ${path.relative(process.cwd(), RESULTS_FILE)}`)
process.exit(counts.FAIL ? 1 : 0)
