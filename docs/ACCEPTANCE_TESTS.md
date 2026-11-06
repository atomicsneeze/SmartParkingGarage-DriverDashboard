# Driver Dashboard — Acceptance Test Scenarios

Formal acceptance scenarios for the Driver Dashboard (roadmap **cs:18 Driver Interface V1**). Each scenario has defined
preconditions, inputs, an expected outcome, and pass/fail criteria, in the same format the team is using for the Unity
simulation and Operator Dashboard tests.

Results are recorded in [Results](#results) at the end. Re-run before each demo build.

## Requirements covered

| ID | Requirement (cs:18 roadmap) | Scenarios |
|---|---|---|
| R1 | Garage availability | DD-01, DD-02, DD-03 |
| R2 | Request parking | DD-04, DD-05, DD-06, DD-07 |
| R3 | Assigned stall | DD-04, DD-05, DD-06 |
| R4 | Parking status | DD-04, DD-08 |
| R5 | Find My Car | DD-14 |
| R6 | Request departure | DD-15, DD-16 |
| Q1 | Unable-to-serve outcomes are reported truthfully | DD-07 to DD-12 |
| Q2 | Connection problems are visible; requests pause | DD-02, DD-03 |
| Q3 | No duplicate cars from refreshes | DD-13 |
| Q4 | Recovery after a backend restart | DD-17, DD-18 |
| Q5 | Same numbers as the Operator Dashboard | DD-01 |

## Test environments

| Env | Setup | Used for |
|---|---|---|
| **A: Live** | PostgreSQL + FastAPI backend, Unity in Play mode (*Run In Background* on), Driver Dashboard (`npm run dev`, port 5174), Operator Dashboard (port 5173) | Final acceptance; everything that can be triggered naturally |
| **B: Backend + simulated Unity** | PostgreSQL + FastAPI backend, `tools/fake_unity_loop.py` with a control file, Driver Dashboard | Failure codes and restarts that are hard to trigger on demand in Unity |
| **C: Demo** | Driver Dashboard only, `?mock=<scenario>` | UI review without the backend |

Starting the backend: see "Starting the backend" in [README.md](../README.md). The automated run (`tools/acceptance.mjs`)
uses Env B.

**General pass rule:** a scenario passes only if every expected outcome is observed and the browser console shows no
JavaScript errors. A `404` for a vehicle that has left the garage is expected and is not an error.

---

## Scenarios

### DD-01 · Live availability matches the garage and the Operator Dashboard
- **Preconditions:** Env A or B; no vehicles parked by drivers.
- **Input:** Open the Driver Dashboard and the Operator Dashboard side by side.
- **Expected:** Status pill shows **Live**. "Open spaces" equals the Operator Dashboard's *Available* and
  `GET /api/garage` → `available`; "of N in service" equals *operational spaces*. Each level's open count equals the
  Operator Dashboard's level card. EV shows open / 8.
- **Pass:** All numbers equal (406 open of 406 in service on the default seed: L1 87, L2 101, L3 111, L4 107).

### DD-02 · Unity stops reporting
- **Preconditions:** DD-01 passing.
- **Input:** Stop Unity (exit Play mode) or set `{"stop": true}` in the control file.
- **Expected:** Within ~6 s the pill shows **Garage offline**, a warning banner explains counts may be out of date, and
  **Find me a space** is disabled with "Requests are paused until the garage is back online."
- **Pass:** All three appear; nothing claims to be live. After Unity resumes, the pill returns to **Live** without
  reloading the page.

### DD-03 · Backend unreachable
- **Input:** Stop the FastAPI backend.
- **Expected:** Pill shows **No connection**; banner states the last update time; last known numbers stay visible.
- **Pass:** As expected; the page does not go blank or crash. Recovers automatically when the backend returns.

### DD-04 · Standard request, no level preference
- **Input:** Space type **Standard**, preferred level **Any**, press **Find me a space**.
- **Expected:** "Finding you a space…" (the backend's `202` is *not* shown as success) → assigned **Level X · Space Y**
  → "Head to your space" → "Pulling in" → **You are parked**. The assigned stall becomes *Reserved*, then *Occupied*
  on the Operator Dashboard.
- **Pass:** The stall shown matches `assigned_space_id` in `GET /api/vehicles/{id}` and the car's location in Unity.

### DD-05 · Standard request with a preferred level
- **Input:** Standard, preferred level **L2**.
- **Expected:** Assigned stall is on Level 2.
- **Pass:** Assigned stall ID starts with `L2_`.

### DD-06 · EV request
- **Input:** Space type **EV charging** (the level picker is hidden; hint says EV spaces are on Level 2).
- **Expected:** Assigned stall is one of `L2_SPACE_029`–`L2_SPACE_036`, shown with an "EV charging" tag.
- **Pass:** As expected; EV open count drops by one.

### DD-07 · EV full (`GarageFull`)
- **Preconditions:** All 8 EV stalls taken, or control file `{"garage_full": true}`.
- **Input:** Request EV.
- **Expected:** "No EV charging spaces open" with a **Request a standard space** button. With no EV stalls open at all,
  the EV option shows **Full** and the request button is disabled before anything is sent.
- **Pass:** Message and options as expected; no vehicle created.

### DD-08 · Preferred level full (`LevelFull`)
- **Input:** Control file `{"level_full": true}`; request Standard on **L3**.
- **Expected:** "That level is full" with **Try any level**; pressing it parks the car on any level.
- **Pass:** As expected.

### DD-09 · Vehicle limit (`VehicleLimitReached`)
- **Input:** Control file `{"limit": true}`; request Standard.
- **Expected:** "Garage is at its vehicle limit" with **Try again**.
- **Pass:** As expected; no vehicle created.

### DD-10 · Entrance blocked (`EntranceBlocked`)
- **Input:** Control file `{"blocked": true}`; request Standard.
- **Expected:** "Entrance is busy" (amber, not red), explaining spaces are available.
- **Pass:** As expected; no vehicle created.

### DD-11 · Garage draining
- **Input:** `POST /api/simulation/drain` (or Operator Dashboard simulation controls); request Standard.
- **Expected:** "Garage is not accepting arrivals".
- **Pass:** As expected. Resume arrivals afterwards.

### DD-12 · Request while Unity offline
- **Input:** With Unity stopped, try to request.
- **Expected:** Button disabled (DD-02). If a request was already in flight, it ends as "Garage is offline … your request
  was not sent" (backend `503`), not as a success.
- **Pass:** No vehicle and no stuck "pending" state.

### DD-13 · Refresh during a journey does not create a second car
- **Input:** During DD-04, reload the page while the car is driving to its stall.
- **Expected:** The same stall and progress reappear.
- **Pass:** Exactly one `POST /api/vehicles/spawn` for the journey; `GET /api/vehicles` shows one driver car.

### DD-14 · Find My Car
- **Preconditions:** Car parked (DD-04).
- **Input:** Open the **My car** tab.
- **Expected:** "Your car is parked at Level X · Space Y", parked time, and the level highlighted in the floor stack.
- **Pass:** Level and space match the assigned stall.

### DD-15 · Driver car stays until the driver leaves, then departs
- **Preconditions:** Car parked from the Driver Dashboard (sent with `auto_depart: false`).
- **Input:** Wait at least 30 s; then press **Request departure**.
- **Expected:** Car is still parked after the wait (simulation cars leave on their own). After the request:
  "Waiting for the garage to confirm" → "Heading to the exit" → "You have left the garage". The stall returns to
  *Available* and both dashboards' open counts go back up by one.
- **Pass:** As expected; the car exits in Unity.

### DD-16 · Departure is only offered when parked
- **Input:** Open **My car** while the car is still driving to its stall.
- **Expected:** **Request departure** is disabled with "Available once you are parked." If Unity refuses a departure,
  its reason is shown and the button comes back.
- **Pass:** As expected.

### DD-17 · Backend restart while parked
- **Preconditions:** Car parked.
- **Input:** Restart the backend process (PostgreSQL keeps running).
- **Expected:** A connection warning during the restart; afterwards **Live** again with the **same** stall and status
  (IDs are stored in PostgreSQL). Departure still works.
- **Pass:** Same `VEH_…` tracked before and after; DD-15 departure succeeds afterwards.

### DD-18 · Backend restart before Unity answers (`OutcomeUnknown`)
- **Input:** Control file `{"hold": true}`; request Standard; once "The garage is choosing your space" shows, restart the
  backend; then clear the control file.
- **Expected:** "We could not confirm your request", never a false success or an endless spinner.
- **Pass:** `GET /api/vehicles/spawn-requests` shows the request as `OutcomeUnknown`.

---

## Results

Legend: ✅ pass · ❌ fail · ◻ not yet run in that environment.

| Scenario | Env B: automated (Nov 6, 2026) | Env A: live Unity |
|---|---|---|
| DD-01 Availability matches Operator Dashboard | ✅ 406 of 406; L1–L4 87/101/111/107; EV 8/8 | ✅ counts updated live (Joshua, Nov 5) |
| DD-02 Unity stops reporting | ✅ | ◻ |
| DD-03 Backend unreachable | ✅ | ✅ warnings, then live again (Joshua, Nov 5) |
| DD-04 Standard request | ✅ | ✅ full trip from Driver Dashboard (Joshua, Nov 5) |
| DD-05 Preferred level | ✅ | ◻ |
| DD-06 EV request | ✅ | ◻ |
| DD-07 EV full (GarageFull) | ✅ | ◻ |
| DD-08 Level full (LevelFull) | ✅ | ◻ |
| DD-09 Vehicle limit | ✅ | ◻ |
| DD-10 Entrance blocked | ✅ | ◻ |
| DD-11 Draining | ✅ | ◻ |
| DD-12 Request while offline | ✅ | ◻ |
| DD-13 Refresh, no duplicate car | ✅ | ◻ |
| DD-14 Find My Car | ✅ | ◻ |
| DD-15 Stays parked, then departs | ✅ | ✅ departed and space reopened (Joshua, Nov 5) |
| DD-16 Departure only when parked | ✅ | ◻ |
| DD-17 Restart while parked | ✅ | ✅ results kept in PostgreSQL; dashboards recovered (Joshua, Nov 5) |
| DD-18 Restart before Unity answers | ✅ | ◻ |

Automated run detail: [acceptance-results.md](acceptance-results.md) (18 passed, 0 failed). Re-run with
`npm run acceptance` (see the header of `tools/acceptance.mjs` for setup).

## Observations for the team

- **Vehicle IDs after a simulation reset.** In the simulated Unity client, vehicle numbering starts again at `VEH_0001`
  after `ResetSimulation`. If real Unity does the same, a driver page still tracking an old car could briefly match a
  new car with the same ID. The dashboard stops tracking as soon as the old car is reported missing, so the risk is
  small, but it is worth confirming how Unity numbers vehicles after a reset (Hayden).
