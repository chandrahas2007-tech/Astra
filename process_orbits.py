"""
process_orbits.py  --  data-integration branch (ASTRA)

Cleans CelesTrak GP records and derives the values the dashboard needs:
altitude, orbit zone, data age (stale flag), object type, density histogram,
zone congestion index and re-entry candidates.
"""
from __future__ import annotations

import math
from collections import Counter
from datetime import datetime, timezone

MU = 398600.4418        # Earth's gravitational parameter, km^3/s^2
R_EARTH = 6378.137      # Earth's equatorial radius, km
STALE_AFTER_DAYS = 7    # tracking data older than this is flagged "stale"
REENTRY_PERIGEE_KM = 300  # heuristic threshold for "near re-entry"

# (label, low km, high km): labels match the frontend density chart
ALT_BANDS = [
    ("300", 200, 400), ("500", 400, 600), ("700", 600, 750), ("800", 750, 850),
    ("900", 850, 950), ("1k", 950, 1100), ("1.2k", 1100, 1350),
    ("1.5k", 1350, 1750), ("2k", 1750, 2000), ("GEO", 35000, 36500),
]

# Risk zones shown on the dashboard
ZONES = [
    ("400-600 km", 400, 600),
    ("700-900 km", 700, 900),
    ("1,000-1,200 km", 1000, 1200),
    ("GEO belt", 35586, 35986),
]


def parse_epoch(text: str) -> datetime:
    dt = datetime.fromisoformat(text)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # CelesTrak epochs are UTC


def classify(name: str, in_active_group: bool) -> str:
    n = name.upper()
    if " DEB" in n or n.endswith("DEB"):
        return "debris"
    if "R/B" in n:
        return "rocket_body"
    return "active_satellite" if in_active_group else "inactive_payload"


def clean_record(rec: dict, in_active_group: bool, now: datetime) -> dict | None:
    """Turn one raw GP record into a clean row. Returns None if unusable."""
    try:
        n = float(rec["MEAN_MOTION"])     # revolutions per day
        ecc = float(rec["ECCENTRICITY"])
        epoch = parse_epoch(rec["EPOCH"])
        if n <= 0 or not (0 <= ecc < 1):
            return None
        sma = (MU / (n * 2 * math.pi / 86400) ** 2) ** (1 / 3)   # semi-major axis, km
        perigee = sma * (1 - ecc) - R_EARTH
        apogee = sma * (1 + ecc) - R_EARTH
        age_days = (now - epoch).total_seconds() / 86400
        return {
            "norad_id": int(rec["NORAD_CAT_ID"]),
            "name": rec["OBJECT_NAME"].strip(),
            "intl_designator": rec.get("OBJECT_ID", ""),
            "type": classify(rec["OBJECT_NAME"], in_active_group),
            "epoch": epoch.isoformat(),
            "data_age_days": round(age_days, 2),
            "stale": age_days > STALE_AFTER_DAYS,
            "inclination_deg": round(float(rec["INCLINATION"]), 3),
            "eccentricity": round(ecc, 6),
            "mean_motion_rev_day": round(n, 6),
            "mean_motion_dot": float(rec.get("MEAN_MOTION_DOT", 0.0)),
            "bstar": float(rec.get("BSTAR", 0.0)),
            "perigee_km": round(perigee, 1),
            "apogee_km": round(apogee, 1),
            "mean_alt_km": round((perigee + apogee) / 2, 1),
        }
    except (KeyError, ValueError, TypeError):
        return None   # skip malformed records instead of crashing


def clean_all(raw: dict[str, list[dict]], now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    rows, seen = [], set()
    for group, in_active in (("active", True), ("debris", False)):
        for rec in raw.get(group, []):
            row = clean_record(rec, in_active, now)
            if row and row["norad_id"] not in seen:   # remove duplicates
                seen.add(row["norad_id"])
                rows.append(row)
    return rows


def density_histogram(rows: list[dict]) -> dict:
    """Counts of working satellites vs debris/rocket bodies per altitude band."""
    active = Counter()
    debris = Counter()
    for r in rows:
        for label, lo, hi in ALT_BANDS:
            if lo <= r["mean_alt_km"] < hi:
                (active if r["type"] == "active_satellite" else debris)[label] += 1
                break
    labels = [b[0] for b in ALT_BANDS]
    return {
        "labels": labels,
        "active": [active[l] for l in labels],
        "debris": [debris[l] for l in labels],
    }


def zone_index(rows: list[dict]) -> list[dict]:
    """Congestion index per zone: object count scaled so the busiest zone = 100."""
    counts = []
    for name, lo, hi in ZONES:
        c = sum(1 for r in rows if lo <= r["mean_alt_km"] < hi)
        counts.append((name, c))
    top = max((c for _, c in counts), default=0) or 1
    return [
        {"zone": n, "objects": c, "index": round(100 * c / top)}
        for n, c in counts
    ]


def reentry_candidates(rows: list[dict], limit: int = 10) -> list[dict]:
    """
    Dead/uncontrolled objects with a very low perigee. This is a HEURISTIC
    shortlist (lowest perigee first), not a predicted re-entry date.
    """
    cand = [
        r for r in rows
        if r["type"] != "active_satellite" and r["perigee_km"] < REENTRY_PERIGEE_KM
    ]
    cand.sort(key=lambda r: r["perigee_km"])
    return cand[:limit]


def build_dashboard(rows: list[dict]) -> dict:
    active = [r for r in rows if r["type"] == "active_satellite"]
    inactive = [r for r in rows if r["type"] != "active_satellite"]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "kpis": {
            "active_satellites": len(active),
            "inactive_or_debris": len(inactive),
            "stale_tracking": sum(1 for r in rows if r["stale"]),
            "near_reentry": sum(
                1 for r in inactive if r["perigee_km"] < REENTRY_PERIGEE_KM
            ),
        },
        "density": density_histogram(rows),
        "zones": zone_index(rows),
        "reentry_candidates": reentry_candidates(rows),
        "notes": {
            "source": "CelesTrak GP data (public catalogue)",
            "stale_rule": f"epoch older than {STALE_AFTER_DAYS} days",
            "reentry_rule": f"non-active object with perigee below {REENTRY_PERIGEE_KM} km (heuristic, not a prediction)",
            "zone_index": "relative to the busiest zone (=100), not an absolute collision probability",
        },
    }
