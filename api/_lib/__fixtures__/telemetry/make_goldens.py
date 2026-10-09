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

    # A WOT pull falling short on boost (with a spool-up transient the rolling median skips).
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

    # Three pedal-down runs: a real pull, one under 1 s (dropped), and one whose
    # gear is a tie between 3 and 4 (pandas' mode picks the smaller).
    c = base()
    wot(c, 5, 15)
    wot(c, 20, 20.6)
    m = wot(c, 26, 33.9)
    idx = np.flatnonzero(m)
    c["Current Gear (-)"][idx[: len(idx) // 2]] = 4.0
    c["Current Gear (-)"][idx[len(idx) // 2:]] = 3.0
    add("two_pulls", c)

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
