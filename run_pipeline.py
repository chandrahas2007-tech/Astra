"""
run_pipeline.py  --  data-integration branch (ASTRA)

Run from the repo root:
    python pipeline/run_pipeline.py            # uses the 2-hour cache
    python pipeline/run_pipeline.py --force    # ignore the cache
    python pipeline/run_pipeline.py --full     # also write data/objects.json (large)

Writes data/dashboard.json, which the website (astra-data.js) loads.
The GitHub Action in .github/workflows/update-data.yml runs this on a schedule.
"""
import argparse
import json
import os
from pathlib import Path

from fetch_celestrak import fetch_all
from process_orbits import build_dashboard, clean_all

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "data"
MIN_ACTIVE = 500   # safety check: refuse to publish if the download looks broken


def write_json(path: Path, obj, **kw) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, **kw))
    os.replace(tmp, path)   # atomic: the site never sees a half-written file


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="ignore the download cache")
    ap.add_argument("--full", action="store_true", help="also write objects.json")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    raw = fetch_all(force=args.force)
    rows = clean_all(raw)
    dashboard = build_dashboard(rows)
    dashboard["sample"] = False

    if dashboard["kpis"]["active_satellites"] < MIN_ACTIVE:
        raise SystemExit(
            f"Only {dashboard['kpis']['active_satellites']} active satellites found; "
            "the download looks incomplete, so data/dashboard.json was NOT updated."
        )

    args.out.mkdir(parents=True, exist_ok=True)
    write_json(args.out / "dashboard.json", dashboard, indent=2)
    if args.full:
        write_json(args.out / "objects.json", rows)
    print(f"Saved {args.out / 'dashboard.json'}  KPIs: {dashboard['kpis']}")


if __name__ == "__main__":
    main()
