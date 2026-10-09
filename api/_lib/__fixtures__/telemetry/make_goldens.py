"""Golden files for the /api/telemetry analysis port.

Run with the Python that has mqbtel installed (its own .venv works):

    <mqbtel>/.venv/Scripts/python api/_lib/__fixtures__/telemetry/make_goldens.py

Writes, next to this script:
  * <name>.csv            synthetic Accessport-style logs (never real ones:
                          this repo is public, and real logs carry where the
                          car was driven)
  * <name>.expected.json  mqbtel's summary of each, as the JS port must produce it
  * describe.expected.json, ap_info.expected.json
  * VERSION               the mqbtel revision the goldens came from

Then `npm run test:api` deep-compares the port against them. When mqbtel
changes: re-run this, bump ANALYZER_VERSION in telemetry-analyze.js to the new
VERSION, then run the page's re-analyse.

    ... make_goldens.py --logs <dir of real CSVs> --out <dir outside the repo>

writes expected JSON for real logs instead, for a local parity check that is
never committed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np

import mqbtel
from mqbtel import parser
from mqbtel.analyze import summarize
from mqbtel.columns import describe

HERE = Path(__file__).resolve().parent
PKG = Path(mqbtel.__file__).resolve().parent
PORTED = ["columns.py", "parser.py", "analyze.py"]

AP_INFO = (
    "AP Info:[AP3-VLK-003 v1.7.6.0-26745]"
    "[USDM Volkswagen CCF Mk7 Golf R / Audi S3 (CYFB 8V09C0BB01)]"
    "[Reflash: EQT - Stage 2 91 v2.52 - LC TC BRBL-S.ptm - TCM: COBB Aggressive v110.ptm]"
)


# --- serialisation -------------------------------------------------------------

def clean(obj):
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return f if math.isfinite(f) else None
    if isinstance(obj, np.integer):
        return int(obj)
    return obj


def summary_json(path: Path) -> dict:
    s = summarize(parser.load(path))
    return clean(asdict(s) | {"worst_level": s.worst_level})


def version() -> str:
    root = PKG.parent
    git = lambda *a: subprocess.run(["git", *a], cwd=root, capture_output=True, text=True).stdout.strip()  # noqa: E731
    head = git("rev-parse", "--short", "HEAD") or "unknown"
    dirty = git("status", "--porcelain", "--", *[f"mqbtel/{f}" for f in PORTED])
    if not dirty:
        return f"mqbtel@{head}"
    digest = hashlib.sha256(b"".join((PKG / f).read_bytes() for f in PORTED)).hexdigest()[:7]
    return f"mqbtel@{head}+wip.{digest}"


def write_csv(path: Path, header: list[str], columns: list, rows: int | None = None,
              cells: dict | None = None, truncate_last: int = 0) -> None:
    """Write header + columns the way the Accessport does (AP Info quoted).

    `cells` overrides individual (row, col) cells with raw text, for blanks and
    junk. `truncate_last` drops that many trailing fields from the final row.
    """
    n = rows if rows is not None else len(columns[0])
    out = []
    for i in range(n):
        row = []
        for j, col in enumerate(columns):
            if cells and (i, j) in cells:
                row.append(cells[(i, j)])
            elif col is None:
                row.append("")
            else:
                v = col[i]
                row.append(f"{float(v):.6g}" if isinstance(v, (float, np.floating)) else str(v))
        out.append(row)
    if truncate_last:
        out[-1] = out[-1][:-truncate_last]
    with path.open("w", newline="", encoding="utf-8") as fh:
        fh.write(",".join(f'"{h}"' if h.startswith("AP Info:") else h for h in header) + "\n")
        csv.writer(fh, lineterminator="\n").writerows(out)


# --- synthetic logs --------------------------------------------------------------

def base(n: int = 200, hz: float = 5.0) -> dict:
    t = np.arange(n) / hz
    z = np.zeros(n)
    return {
        "Time (sec)": t,
        "Engine Speed (RPM)": np.full(n, 2000.0),
        "Accel Pedal Position (%)": np.full(n, 30.0),
        "Boost Press. (psi)": np.full(n, 5.0),
        "PUT Set Point (psi)": np.full(n, 19.5),
        "Press Upstream Throttle (psi)": np.full(n, 19.5),
        "Charge Air Temperature (C)": np.linspace(30, 50, n),
        "Torque Actual (ft-lb)": np.full(n, 100.0),
        "Current Gear (-)": np.full(n, 4.0),
        "Knock Retard Cylinder 1 (Degrees)": z.copy(),
        "Knock Retard Cylinder 2 (Degrees)": z.copy(),
        "Knock Retard Cylinder 3 (Degrees)": z.copy(),
        "Knock Retard Cylinder 4 (Degrees)": z.copy(),
        "LTFT (%)": np.full(n, 1.0),
        "STFT (%)": np.full(n, -0.8),
        "AFR (AFR)": np.full(n, 14.7),
        "AFR Set Point (AFR)": np.full(n, 14.7),
        "Rail Press. (psi)": np.full(n, 580.0),
        "Rail Pressure Set Point (psi)": np.full(n, 580.0),
        "Ignition Timing Final (Degrees)": np.full(n, 18.0),
        "(DSG)Vehicle Speed (mph)": np.full(n, 45.0),
        "Exhaust Cam Position (Degrees)": np.full(n, -12.5),
    }


def wot(c: dict, start: float, end: float, gear: float = 3.0) -> np.ndarray:
    """Floor it between start and end seconds. Returns the row mask."""
    t = c["Time (sec)"]
    m = (t >= start) & (t <= end)
    k = int(m.sum())
    c["Accel Pedal Position (%)"][m] = 100.0
    c["Engine Speed (RPM)"][m] = np.linspace(2500, 6500, k)
    c["Boost Press. (psi)"][m] = 24.0
    c["PUT Set Point (psi)"][m] = 38.5
    c["Press Upstream Throttle (psi)"][m] = 38.5
    c["Torque Actual (ft-lb)"][m] = 380.0
    c["Current Gear (-)"][m] = gear
    c["Rail Pressure Set Point (psi)"][m] = 2900.0
    c["Rail Press. (psi)"][m] = 2880.0
    c["AFR (AFR)"][m] = 11.6
    c["AFR Set Point (AFR)"][m] = 11.5
    c["Ignition Timing Final (Degrees)"][m] = 8.0
    return m


def emit(name: str, c: dict, **kw) -> None:
    header = list(c.keys()) + [AP_INFO]
    write_csv(HERE / f"{name}.csv", header, list(c.values()) + [None], **kw)


def fixtures() -> list[str]:
    made = []

    def add(name, c, **kw):
        emit(name, c, **kw)
        made.append(name)

    # A cruise with no WOT pull.
    c = base()
    c["LTFT (%)"] = 1.0 + 0.6 * np.sin(np.arange(200) / 9.0)
    add("cruise_no_wot", c)

    # A WOT pull falling short on boost (its two-sample spool-up transient is below 3000 rpm).
    c = base()
    m = wot(c, 5, 15)
    idx = np.flatnonzero(m)
    c["Press Upstream Throttle (psi)"][m] = 38.5 - 3.2
    c["Press Upstream Throttle (psi)"][idx[:2]] = 25.0
    add("wot_short_boost", c)

    # Knock on one cylinder under boost (Cobb logs retard negative).
    c = base()
    m = wot(c, 5, 15)
    idx = np.flatnonzero(m)
    c["Knock Retard Cylinder 2 (Degrees)"][idx[30:42]] = -4.5
    c["Knock Retard Cylinder 2 (Degrees)"][idx[42:45]] = -1.25
    add("knock_one_cyl_boost", c)

    # A uniform, off-boost timing pull: identical on every cylinder.
    c = base()
    c["Boost Press. (psi)"][100:108] = 1.0
    for cyl in range(1, 5):
        c[f"Knock Retard Cylinder {cyl} (Degrees)"][100:108] = -1.5
    add("uniform_timing_pull", c)

    # Charge air heat soak, plus an oil temp channel for peak tracking.
    c = base()
    c["Charge Air Temperature (C)"] = np.linspace(40, 95, 200)
    c["Engine Oil Temp. (C)"] = np.linspace(80, 104, 200)
    add("cat_heat_soak", c)

    # Long-term fuel trim drift; idle rows below 500 rpm don't count.
    c = base()
    c["LTFT (%)"] = 11.2 + 0.4 * np.cos(np.arange(200) / 7.0)
    c["Engine Speed (RPM)"][:20] = 0.0
    c["LTFT (%)"][:20] = 30.0
    add("ltft_drift", c)

    # Rail pressure droop at full load.
    c = base()
    m = wot(c, 5, 15)
    c["Rail Press. (psi)"][m] = 2450.0
    add("rail_droop", c)

    # Lean AFR under boost.
    c = base()
    m = wot(c, 5, 15)
    c["AFR (AFR)"][m] = 12.4
    add("afr_lean", c)

    # Spool-up and shifts are not faults (mqbtel's tests/test_coverage.py). Each of
    # these warned under the old 5-sample rolling median; the shapes are adapted from
    # the tests' 10 Hz so they still do at base()'s 5 Hz. wot_short_boost and afr_lean
    # above are the sustained shortfall and lean cases.

    # PUT still climbing at 25 psi/s as rpm passes 3000 (t = 6.4 s): spool-up, not a leak.
    c = base()
    wot(c, 5, 15)
    t = c["Time (sec)"]
    c["Press Upstream Throttle (psi)"] = np.minimum(c["PUT Set Point (psi)"], 19.5 + 25.0 * np.clip(t - 6.2, 0, None))
    add("boost_spool_up", c)

    # A 6 psi PUT dip for 0.6 s through the 2-3 upshift at 12 s.
    c = base()
    m = wot(c, 5, 15)
    t = c["Time (sec)"]
    c["Current Gear (-)"][m] = np.where(t[m] < 12.0, 2.0, 3.0)
    c["Press Upstream Throttle (psi)"][(t >= 12.0) & (t < 12.6)] -= 6.0
    add("boost_shift_dip", c)

    # An upshift's fuel cut, read by the wideband as a spike to AFR 28, at a steady
    # 20 psi. The test puts it 0.4 s after the gear change; at 5 Hz the old median
    # needs three lean samples, and all three must fall inside SHIFT_SETTLE_S, so
    # here it starts 0.2 s after.
    c = base()
    t = c["Time (sec)"]
    c["Boost Press. (psi)"][:] = 20.0
    c["AFR (AFR)"][:] = 11.5
    c["AFR Set Point (AFR)"][:] = 11.6
    c["Current Gear (-)"] = np.where(t < 2.0, 2.0, 3.0)
    c["AFR (AFR)"][11:14] = [28.0, 17.0, 13.0]
    add("afr_shift_fuel_cut", c)

    # Boost building at 25 psi/s and the enrichment target stepping richer past 15 psi,
    # with the wideband two samples (0.4 s) behind it.
    c = base()
    t = c["Time (sec)"]
    boost = np.clip(25.0 * (t - 5.0), 0.0, 20.0)
    c["Boost Press. (psi)"] = boost
    c["AFR Set Point (AFR)"] = np.where(boost > 15, 11.6, 13.0)
    c["AFR (AFR)"] = np.roll(c["AFR Set Point (AFR)"], 2)
    add("afr_spool_lag", c)

    # A 1.2 s pedal stab still spooling when it ends: enough samples for both checks,
    # but no settled stretch long enough to judge either, so both are idle.
    c = base()
    m = wot(c, 5, 6.2)
    t = c["Time (sec)"]
    c["Press Upstream Throttle (psi)"][m] = np.minimum(38.5, 19.5 + 25.0 * (t[m] - 5.0))
    c["Boost Press. (psi)"][m] = np.minimum(24.0, 6.0 + 25.0 * (t[m] - 5.0))
    add("short_stab_unsettled", c)

    # Ignition on, engine off.
    c = base(30)
    c["Engine Speed (RPM)"][:] = 0.0
    c["Accel Pedal Position (%)"][:] = 0.0
    add("ignition_on_only", c)

    # Duplicated (DSG) headers: pandas renames the copies X.1, X.2 and the parser
    # drops X.1. The CAT copy reads 99 C, so keeping the wrong one shows up as a warn.
    c = base()
    header = list(c.keys())
    cols = list(c.values())
    header += ["(DSG)Clutch 1 Slip (RPM)", "(DSG)Clutch 1 Slip (RPM)", "(DSG)Clutch 1 Slip (RPM)",
               "Charge Air Temperature (C)", AP_INFO]
    cols += [np.full(200, 12.0), np.full(200, 13.0), np.full(200, 14.0), np.full(200, 99.0), None]
    write_csv(HERE / "dup_dsg_headers.csv", header, cols)
    made.append("dup_dsg_headers")

    # No knock channels at all.
    c = base()
    for cyl in range(1, 5):
        del c[f"Knock Retard Cylinder {cyl} (Degrees)"]
    add("no_knock_channels", c)

    # Blank and text cells, an all-blank boost column, and a truncated last row.
    c = base()
    m = wot(c, 5, 15)
    j = list(c.keys()).index
    cells = {}
    for i in (3, 50, 51, 52, 150):
        cells[(i, j("Charge Air Temperature (C)"))] = ""
    cells[(60, j("Charge Air Temperature (C)"))] = "--"
    cells[(61, j("LTFT (%)"))] = "N/A"
    cells[(62, j("LTFT (%)"))] = " 2.5 "
    for i in range(200):
        cells[(i, j("Boost Press. (psi)"))] = ""
    add("messy_cells", c, cells=cells, truncate_last=5)

    # Exact ties for Python's half-even formatting: CAT tops out at 72.5,
    # peak pedal is 68.5 and LTFT sits at exactly +2.25.
    c = base()
    c["Charge Air Temperature (C)"] = np.linspace(30, 72.5, 200)
    c["Accel Pedal Position (%)"][150:160] = 68.5
    c["LTFT (%)"][:] = 2.25
    add("tie_rounding", c)

    # Small retard concentrated on one cylinder, on boost but under the warn line.
    c = base()
    c["Knock Retard Cylinder 3 (Degrees)"][120:132] = -0.8
    c["Knock Retard Cylinder 1 (Degrees)"][180:183] = -0.5
    add("knock_cyl_concentration", c)

    # Three pedal-down runs: a real pull, one under 2 s (dropped), and one whose
    # gear is a tie between 3 and 4 (pandas' mode picks the smaller).
    c = base()
    wot(c, 5, 15)
    wot(c, 20, 20.6)
    m = wot(c, 26, 33.9)
    idx = np.flatnonzero(m)
    c["Current Gear (-)"][idx[: len(idx) // 2]] = 4.0
    c["Current Gear (-)"][idx[len(idx) // 2:]] = 3.0
    add("two_pulls", c)

    def burst(c, start, end, pedal, boost, put):
        """Part-throttle load between start and end seconds, in 2nd, climbing through the revs."""
        t = c["Time (sec)"]
        on = (t >= start) & (t <= end)
        c["Accel Pedal Position (%)"][on] = pedal
        c["Engine Speed (RPM)"][on] = np.linspace(3400, 5900, int(on.sum()))
        c["Boost Press. (psi)"][on] = boost
        c["PUT Set Point (psi)"][on] = 38.5
        c["Press Upstream Throttle (psi)"][on] = put
        c["Current Gear (-)"][on] = 2.0
        return on

    # Lifting at peak torque: 78% pedal, but 24 psi for 2.4 s. Boost alone makes it a pull.
    c = base()
    burst(c, 10.0, 12.4, pedal=78.0, boost=24.0, put=38.3)
    add("boost_burst_lift", c)

    # The same burst lasting 1.8 s: under the 2 s minimum, so no pull, and the
    # no-pull finding names both peaks.
    c = base()
    burst(c, 10.0, 11.8, pedal=78.0, boost=24.0, put=38.3)
    add("boost_burst_short", c)

    # Floored for 3 s at low revs with little boost: the pedal alone makes it a pull.
    c = base()
    t = c["Time (sec)"]
    on = (t >= 10.0) & (t <= 13.0)
    c["Accel Pedal Position (%)"][on] = 100.0
    c["Engine Speed (RPM)"][on] = np.linspace(2100, 2900, int(on.sum()))
    c["Boost Press. (psi)"][on] = 8.0
    add("floored_low_boost", c)

    # Floored while spooling (14 psi), then lifted to 75% once at 24 psi: the
    # pedal rule hands over to the boost rule with no gap, so it is one pull.
    c = base()
    t = c["Time (sec)"]
    burst(c, 10.0, 13.0, pedal=75.0, boost=24.0, put=38.4)
    floor = (t >= 10.0) & (t <= 11.2)
    c["Accel Pedal Position (%)"][floor] = 100.0
    c["Boost Press. (psi)"][floor] = 14.0
    c["Press Upstream Throttle (psi)"][floor] = 28.5
    add("pedal_to_boost_handover", c)

    # --- engine insights: fuel pump headroom, DSG clutch slip and shift timing, per-pull curves.
    HPFP, SLIP, TARGET = "HPFP Effective Pump Vol (%)", "(DSG)Clutch 1 Slip (RPM)", "(DSG)Target Gear (Gear)"
    SPEED, GEAR, RPM, TQ = "(DSG)Vehicle Speed (mph)", "Current Gear (-)", "Engine Speed (RPM)", "Torque Actual (ft-lb)"

    # A 1st-2nd-3rd pull with every insight channel. Target gear leads Current Gear by
    # 0.4 s and the handover (rpm drop, torque cut) follows the flip by 0.4 s, so each
    # upshift times at 0.8 s. The pump sits at 100%. Clutch 1 slips 400 rpm pulling away
    # under 15 mph and 1,800 rpm through the 2-3 handover, both by design, and holds 12 rpm
    # settled in 1st and 3rd; in 2nd it isn't driving, so it reads the gap to 1st.
    c = base(250)
    t = c["Time (sec)"]
    m = wot(c, 10, 20)
    g1, g2, g3 = m & (t < 13.0), m & (t >= 13.0) & (t < 16.6), m & (t >= 16.6)
    c[GEAR][g1], c[GEAR][g2], c[GEAR][g3] = 1.0, 2.0, 3.0
    c[TARGET] = c[GEAR].copy()
    c[TARGET][m & (t >= 12.6) & (t < 13.0)] = 2.0
    c[TARGET][m & (t >= 16.2) & (t < 16.6)] = 3.0
    r1, r2, r3 = m & (t < 13.4), m & (t >= 13.4) & (t < 17.0), m & (t >= 17.0)
    c[RPM][r1] = np.linspace(3000, 6250, int(r1.sum()))
    c[RPM][r2] = np.linspace(4250, 6250, int(r2.sum()))
    c[RPM][r3] = np.linspace(4750, 6000, int(r3.sum()))
    c[TQ][m] = 412.0 - 0.03 * np.abs(c[RPM][m] - 4500.0)
    c[TQ][m & np.isin(t, [13.4, 17.0])] = 70.0
    c["Ignition Timing Final (Degrees)"][m] = (c[RPM][m] - 3000.0) / 500.0
    c["Charge Air Temperature (C)"][m] = np.linspace(68, 141, int(m.sum()))
    c[SPEED][m] = np.linspace(5, 70, int(m.sum()))
    c[HPFP] = np.where(m, 100.0, 40.0)
    c["Air Mass IM Per Stroke (mg/stk)"] = np.where(m, 1500.0, 400.0)
    c["Air Mass Per Stroke SP (mg/stk)"] = np.where(m, 1800.0, 420.0)
    c["Air Mass Per Stroke SP (mg/stk)"][np.flatnonzero(m)[20]] = 0.0
    c["Torque Maximum Engine (ft-lb)"] = np.full(250, 441.0)
    c["Torque Limitation Source (-)"] = np.where(m & (c[TQ] >= 405.0), 64.0, 0.0)
    slip = np.where(c[GEAR] % 2 == 1, 12.0, -2000.0)
    slip[g1 & (c[SPEED] < 15)] = 400.0
    slip[m & (t >= 16.6) & (t < 17.4)] = 1800.0
    c[SLIP] = slip
    j = list(c.keys()).index
    add("insights_pull", c, cells={(int(np.flatnonzero(m)[5]), j("Torque Limitation Source (-)")): ""})

    # Clutch 1 slipping 120 rpm under load in 3rd: warn. No pump channel, so that check is missing.
    c = base()
    m = wot(c, 8, 18)
    c[SPEED][m] = 50.0
    c[SLIP] = np.where(m, 120.0, 10.0)
    add("clutch_slipping", c)

    # 60 rpm of slip (watch), and a pump with headroom whose one sample at 100% isn't held.
    c = base()
    m = wot(c, 8, 18)
    c[SPEED][m] = 50.0
    c[SLIP] = np.where(m, 60.0, 10.0)
    c[HPFP] = np.where(m, 84.0, 40.0)
    c[HPFP][np.flatnonzero(m)[30]] = 100.0
    add("clutch_watch_hpfp_ok", c)

    # mqbtel's own live-logger CSV: canonical headers, no AP Info.
    n = 120
    t = np.arange(n) / 5.0
    live = {
        "time_s": t,
        "rpm": np.full(n, 1800.0),
        "pedal_pct": np.full(n, 22.0),
        "boost_psi": np.full(n, 2.5),
        "cat_c": np.linspace(25, 41, n),
        "ltft_pct": np.full(n, -3.0),
        "coolant_c": np.full(n, 90.0),
        "speed_kmh": np.full(n, 60.0),
    }
    write_csv(HERE / "mqbtel_live.csv", list(live.keys()), list(live.values()))
    made.append("mqbtel_live")

    return made


# Real Accessport channel names (names only, no data) plus edge cases, for describe().
DESCRIBE_HEADERS = [
    "time_s", "rpm", "boost_psi", "cat_c", "kr_cyl3", "speed_kmh", "gear",
    "(DSG)Accel Pedal (%)", "(DSG)Clutch 1 Slip (RPM)", "(DSG)Clutch 1 Solenoid Duty Cycle (%)",
    "(DSG)Clutch 2 Pressure (psi)", "(DSG)Engine Intervention Flags ()", "(DSG)Engine Torque (ft-lb)",
    "(DSG)Line Pressure Set Point (psi)", "(DSG)Target Gear (Gear)", "(DSG)Target Upshift Speed (RPM)",
    "Air Mass IM Per Stroke (mg/stk)", "Air Mass IM SP (g/s)", "COBB Spark Reduction (Degrees)",
    "Exhaust Cam Position (Degrees)", "HPFP Effective Pump Vol (%)",
    "Injection Time Primary Pulse Average (us)", "Intake Cam Position (Degrees)",
    "Intake Flap Set Point (-)", "Mass Flow Limit 1 (mg/stk)", "Maximum Torque at Clutch (ft-lb)",
    "TPS (TPS)", "Torque Limitation Source (-)", "Trq Value Air Mass SP (ft-lb)",
    "Turbine Act. Final Value (%)", "Wastegate Mass Flow SP (g/s)", "Barometric Pressure (kPa)",
    "Coolant Temp (C)", "No unit here", "Weird (nested (unit))", "  Spacey Label  ( psi )  ",
]

AP_INFO_CASES = [
    AP_INFO,
    "AP Info:[AP3-VLK-003 v1.0][Car][Reflash: Stage1.ptm]",
    "AP Info:[AP3-VLK-003][Only two]",
    "AP Info:[ vvv2.0 ]",
    "",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--logs", type=Path, help="real logs to summarise (local parity check)")
    ap.add_argument("--out", type=Path, help="where to write their expected JSON")
    args = ap.parse_args()

    if args.logs:
        if not args.out:
            sys.exit("--logs needs --out (somewhere outside the repo)")
        args.out.mkdir(parents=True, exist_ok=True)
        for p in parser.discover([str(args.logs)]):
            (args.out / f"{p.stem}.expected.json").write_text(json.dumps(summary_json(p), indent=1), encoding="utf-8")
            print("wrote", p.stem)
        return

    for name in fixtures():
        (HERE / f"{name}.expected.json").write_text(
            json.dumps(summary_json(HERE / f"{name}.csv"), indent=1, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print("wrote", name)
    (HERE / "describe.expected.json").write_text(
        json.dumps({h: asdict(describe(h)) for h in DESCRIBE_HEADERS}, indent=1) + "\n",
        encoding="utf-8",
    )
    (HERE / "ap_info.expected.json").write_text(
        json.dumps({s: parser.parse_ap_info(s) for s in AP_INFO_CASES}, indent=1) + "\n",
        encoding="utf-8",
    )
    v = version()
    (HERE / "VERSION").write_text(v + "\n", encoding="utf-8")
    print("VERSION", v)


if __name__ == "__main__":
    main()
