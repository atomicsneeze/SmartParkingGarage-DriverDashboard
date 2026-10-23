# Driver Dashboard (cs:18 – Driver Interface V1)

Driver interface for the Smart Parking Garage (designed for phone screens). React + TypeScript + Vite, same stack and visual style as the Operator Dashboard. It reads from and sends commands to the existing FastAPI backend only. **No backend or Unity files are modified.**

The backend contract in `src/api/contract.ts` mirrors the Pydantic models in the team GitHub repo
(`CEN4090L-Fall-2026/SmartParkingGarage`, `Backend/src/smart_parking_backend/models/*.py`, commit `3184c60`; summary in `docs/frontend-api.md`). It has been tested end-to-end against that backend.

## Run it

```bash
npm install
npm run dev          # http://localhost:5174
```

| Mode | How |
|---|---|
| **Real system** | Start the backend (`cd Backend && uv sync && uv run uvicorn smart_parking_backend.main:app --host 127.0.0.1 --port 8000`), press Play in Unity (*Run In Background* on), open `http://localhost:5174`. |
| **Real backend, no Unity** | Backend as above, then from `Backend/`: `uv run python <path>/DriverDashboard/tools/fake_unity_loop.py .` Built on the backend's own `tests/fake_unity.py`; handles departures, `auto_depart` and error codes. |
| **Demo data only** | `http://localhost:5174/?mock=1`. Scenarios: `normal`, `evfull`, `draining`, `blocked`, `levelfull`, `limit`, `nodepart`, `slow`, `stale`, `offline` (switchable from the footer). The demo backend returns the same JSON as FastAPI, so it runs the real parsing code. |
| **On your phone** | `npm run dev -- --host`, open the Network URL on the same Wi-Fi. |

Checks: `npm run build` (TypeScript + production build), `npm run lint`.

**Why port 5174 + a proxy:** the backend's CORS list only allows `:5173` and `:3000` (`Backend/app/main.py`). Vite forwards `/api` and `/health` to FastAPI (see `vite.config.ts`), so the browser never makes a cross-origin call and the backend needs no change. It also lets the Operator Dashboard keep `:5173`.

## What the driver can do

| Journey stage | Behaviour | Backend used |
|---|---|---|
| Check | Open spaces now, Standard vs EV (x / 8), by level. OutOfService and Reserved are never "open". | `GET /api/spaces`, `GET /api/integration/status` (~1 s) |
| Request | Standard or EV, optional preferred level (Standard only; EV stalls are all on L2). Disabled when full or garage offline. Sends `auto_depart: false` so the car waits for the driver. | `POST /api/vehicles/spawn` `{request_type, preferred_level?, auto_depart: false}` |
| Pending | 202 is *queued*, not success. Shows "waiting for the garage" → "garage is choosing your space" as the request moves `AcceptedByBackend → ForwardedToUnity`. Warns after 15 s. | `GET /api/vehicles/spawn-requests/{REQ_…}` |
| Assigned / parked | Stall Unity assigned ("Level 3 · Space 42") and live stage: driving → pulling in → parked → leaving. | `GET /api/vehicles/{VEH_…}` (`lifecycle_state`, `assigned_space_id`) |
| Unable to serve | Separate wording per `error_code`: `GarageFull` (offers standard if EV full), `LevelFull` (offers "Try any level"), `VehicleLimitReached`, `EntranceBlocked`; plus draining, garage offline (503), cancelled by reset, rejected. Falls back to the message text when no code is sent. | `status: Failed` + `error_code` / `failure_reason` |
| Find My Car | Level, space, parked time, highlighted floor. | — |
| Departure | **Request departure** (once parked) → "waiting for the garage" → "heading to the exit" → "you have left". If Unity refuses, the reason is shown and the button comes back. Acknowledged ≠ exited: the app waits for the car's own lifecycle. | `POST /api/vehicles/{vehicle_id}/depart`, `GET /api/integration/commands/{id}` |
| Offline / stale | Pill + banner when FastAPI is unreachable or `data_source` isn't `UnityLive`; requests pause; last data kept and labelled. | `connected`, `data_source` |

Refreshing the page resumes tracking the same request or car from `localStorage`; it never re-sends. If the backend restarts (`backend_instance_id` changes) tracking stops, because in-memory IDs like `VEH_0001` may be reused for a different car.

## Code map

```
src/
  config.ts                 poll rate, timeouts, demo scenario, departure endpoint switch
  api/
    contract.ts             ← ONLY file with backend JSON shapes (Raw* types = Pydantic models) + mappers
    types.ts                app-level types the UI uses
    httpClient.ts           API client over a swappable transport (fetch, or the demo backend)
    mockBackend.ts          demo FastAPI+Unity returning raw backend JSON (real stall IDs from seed_data.py)
  hooks/
    useGarageFeed.ts        polls status + spaces, works out connection state
    useParkingSession.ts    driver journey state machine (idle → pending → active → ended / failed)
    usePolling.ts, useNow.ts
  lib/
    availability.ts         Standard/EV/per-level counts
    driverCopy.ts           all driver-facing wording
  components/               ParkingCard, AvailabilityCard, MyCarView, Connection, Icons
tools/fake_unity_loop.py    drive the real backend without Unity (uses Backend/tests/fake_unity.py)
```

## Open items

1. **Live Unity test:** the backend supports `auto_depart`, `DepartVehicle` and `error_code`; confirm with Hayden that the Unity bridge consumes them, then run the full driver journey with Unity in Play mode.
2. **Idempotent spawn (optional, Joshua):** the spawn body forbids extra fields, so the client can't send its own request id. If the page reloads *during* the POST itself (a fraction of a second), the app can't tell whether it was queued, so it says so rather than risk a second car.
3. **Driver ownership:** there is no authentication, so any client could depart any vehicle ID. Fine for the class demo; worth noting if accounts are added later.

## Not in scope yet (per roadmap)

Turn-by-turn guidance / route display (cs:19), driver accounts/authentication, reservations (cs:23), persistent history (cs:22).
