"""
Test the Driver Dashboard against the REAL backend without opening Unity.

Built on the backend team's protocol stand-in (Backend/tests/fake_unity.py), plus what the driver flow needs:
  * cars move over time: DrivingToStall -> Parking -> Parked
  * auto_depart: true cars leave on their own after a while; auto_depart: false cars wait for a departure
  * DepartVehicle commands: accepted for a parked car (Departing -> DrivingToExit -> gone), refused otherwise
  * failures carry error codes: GarageFull, LevelFull, VehicleLimitReached, EntranceBlocked
It is NOT a traffic simulation and does not prove how real Unity behaves.

Usage (from the team GitHub repo's Backend/ folder, with the backend already running on :8000):
    uv run python <path-to>/DriverDashboard/tools/fake_unity_loop.py .

Optional: pass a JSON control file as a 2nd argument to flip scenarios while it runs, e.g.
    {"blocked": true}   -> spawns fail with EntranceBlocked
    {"garage_full": true} / {"level_full": true} -> spawns fail with GarageFull / LevelFull (preferred level)
    {"limit": true}     -> spawns fail with VehicleLimitReached
    {"stop": true}      -> stop reporting (dashboard should show "Garage offline" after ~5 s)
    {"hold": true}      -> receive commands but never answer them (restart the backend now -> OutcomeUnknown)
If the backend restarts, this loop starts a new Unity session, like real Unity does.
Stop with Ctrl+C.
"""

import json
import pathlib
import sys
import time

import httpx

sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else ".")  # the Backend/ folder
from tests.fake_unity import FakeUnity  # noqa: E402

control = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
DRIVE_S, PARK_S, AUTO_DEPART_AFTER_S, DEPART_S, EXIT_S = 4, 3, 20, 2, 3


def settings() -> dict:
    try:
        return json.loads(control.read_text() or "{}") if control else {}
    except (OSError, ValueError):
        return {}


client = httpx.Client(base_url="http://127.0.0.1:8000")
# A fresh session id per run, like Unity entering Play mode (the backend remembers old sessions).
unity = FakeUnity(client, session=f"DRIVER_DASHBOARD_TEST_{int(time.time())}")
assert unity.snapshot().status_code == 200, "Is the backend running on :8000?"
client.post("/api/simulation/start")
for command in unity.poll():
    unity.ack(command["command_id"], *unity.execute(command))
print("Fake Unity connected. Open the dashboard at http://localhost:5174 (Ctrl+C to stop).")

timeline: dict[str, dict] = {}  # vehicle_id -> {"born", "auto_depart", "depart_at"}
spaces_by_id = {space["space_id"]: space for space in unity.spaces}


def spawn(payload: dict) -> tuple[bool, str, str | None, str | None]:
    flags = settings()
    if flags.get("blocked"):
        return False, "Entrance is blocked; try again shortly.", None, "EntranceBlocked"
    if flags.get("limit"):
        return False, "Vehicle limit reached.", None, "VehicleLimitReached"
    wanted, level = payload["request_type"], payload.get("preferred_level")
    pool = [s for s in unity.spaces if s["state"] == "Available" and s["space_type"] == wanted]
    if flags.get("garage_full") or not pool:
        return False, "No matching available space.", None, "GarageFull"
    on_level = [s for s in pool if level is None or s["level"] == level]
    if not on_level or (level and flags.get("level_full")):
        return False, f"{level} is full.", None, "LevelFull"
    chosen = on_level[0]
    number = unity.sim["total_spawned"] + 1
    vehicle_id, requester = f"VEH_{number:04d}", f"SIM_VEH_{number:04d}"
    chosen.update(state="Reserved", assigned_vehicle_id=vehicle_id, reserved_by=requester)
    unity.vehicles.append(
        {
            "vehicle_id": vehicle_id,
            "requester_id": requester,
            "request_type": wanted,
            "lifecycle_state": "DrivingToStall",
            "assigned_space_id": chosen["space_id"],
            "preferred_level": level,
            "failure_reason": None,
        }
    )
    unity.sim["total_spawned"] = number
    timeline[vehicle_id] = {"born": time.time(), "auto_depart": payload.get("auto_depart", True), "depart_at": None}
    return True, f"Spawned {vehicle_id}.", vehicle_id, None


def depart(payload: dict) -> tuple[bool, str, None, None]:
    vehicle = next((v for v in unity.vehicles if v["vehicle_id"] == payload.get("vehicle_id")), None)
    if vehicle is None:
        return False, f"Vehicle {payload.get('vehicle_id')} does not exist.", None, None
    if vehicle["lifecycle_state"] != "Parked":
        return False, f"Vehicle {vehicle['vehicle_id']} is not parked.", None, None
    timeline[vehicle["vehicle_id"]]["depart_at"] = time.time()
    return True, "Departure started.", None, None


def execute(command: dict) -> tuple[bool, str, str | None, str | None]:
    kind, payload = command["command_type"], command["payload"]
    if kind == "SpawnVehicle" and unity.sim["state"] != "Draining":
        return spawn(payload)
    if kind == "DepartVehicle":
        return depart(payload)
    success, message, vehicle_id = unity.execute(command)
    return success, message, vehicle_id, None


def move_vehicles(now: float) -> None:
    for vehicle in list(unity.vehicles):
        t = timeline.setdefault(vehicle["vehicle_id"], {"born": now, "auto_depart": True, "depart_at": None})
        age = now - t["born"]
        if t["depart_at"] is None and t["auto_depart"] and age > DRIVE_S + PARK_S + AUTO_DEPART_AFTER_S:
            t["depart_at"] = now
        space = spaces_by_id.get(vehicle["assigned_space_id"])
        if t["depart_at"] is not None:
            gone = now - t["depart_at"]
            if gone < DEPART_S:
                vehicle["lifecycle_state"] = "Departing"
            elif gone < DEPART_S + EXIT_S:
                vehicle["lifecycle_state"] = "DrivingToExit"
                if space:
                    space.update(state="Available", assigned_vehicle_id=None, reserved_by=None)
            else:
                unity.vehicles.remove(vehicle)
                unity.sim["total_completed"] += 1
        elif age < DRIVE_S:
            vehicle["lifecycle_state"] = "DrivingToStall"
        elif age < DRIVE_S + PARK_S:
            vehicle["lifecycle_state"] = "Parking"
        else:
            vehicle["lifecycle_state"] = "Parked"
            if space:
                space["state"] = "Occupied"


def backend_instance() -> str | None:
    try:
        return client.get("/api/integration/status").json()["backend_instance_id"]
    except (httpx.HTTPError, KeyError, ValueError):
        return None


processed: dict[str, tuple] = {}
instance = backend_instance()
while True:
    flags = settings()
    if flags.get("stop"):
        time.sleep(0.5)
        continue
    try:
        current = backend_instance()
        if current and current != instance:
            # Backend restarted: start a new Unity session (new id, sequence restarts at 1).
            instance = current
            unity.session = f"DRIVER_DASHBOARD_TEST_{int(time.time())}"
            unity.sequence = 0
            print("Backend restarted; new session", unity.session)
            unity.snapshot()  # announce the new session before asking for commands (409 otherwise)
        if current:
            for command in unity.poll():
                command_id = command["command_id"]
                if flags.get("hold"):
                    continue  # received but never answered
                if command_id not in processed:  # at-least-once delivery: never execute twice
                    processed[command_id] = execute(command)
                unity.ack(command_id, *processed[command_id])
            move_vehicles(time.time())
            unity.snapshot()
    except (httpx.HTTPError, AssertionError):
        pass  # backend down/restarting or session mismatch; keep trying
    time.sleep(0.5)
