"""
fetch_celestrak.py  --  data-integration branch (ASTRA)

Downloads orbital data (GP elements, JSON format) from CelesTrak and caches it
on disk so we never hammer their server. CelesTrak asks users not to download
the same data more than about once every 2 hours, and blocks repeat offenders.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import httpx

BASE_URL = "https://celestrak.org/NORAD/elements/gp.php"
RAW_DIR = Path(__file__).resolve().parent / ".cache"   # ignored by git
CACHE_TTL_SECONDS = 2 * 60 * 60  # 2 hours

# Group names as listed at https://celestrak.org/NORAD/elements/
ACTIVE_GROUPS = ["active"]
DEBRIS_GROUPS = [
    "cosmos-2251-debris",
    "iridium-33-debris",
    "fengyun-1c-debris",
    "cosmos-1408-debris",
]


def _cache_path(group: str) -> Path:
    return RAW_DIR / f"{group}.json"


def _cache_is_fresh(path: Path) -> bool:
    return path.exists() and (time.time() - path.stat().st_mtime) < CACHE_TTL_SECONDS


def fetch_group(group: str, force: bool = False) -> list[dict]:
    """Return a list of GP records for one CelesTrak group (cached)."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(group)

    if not force and _cache_is_fresh(path):
        return json.loads(path.read_text())

    try:
        resp = httpx.get(
            BASE_URL,
            params={"GROUP": group, "FORMAT": "json"},
            headers={"User-Agent": "ASTRA-hackathon/1.0"},
            timeout=30.0,
            follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()  # CelesTrak returns plain text (not a list) on errors
        if not isinstance(data, list):
            raise ValueError(f"Unexpected response for group '{group}': {str(data)[:100]}")
        path.write_text(json.dumps(data))
        return data
    except (httpx.HTTPError, ValueError) as err:
        # Fall back to old cached data (still useful, we flag its age later)
        if path.exists():
            print(f"[warn] {group}: download failed ({err}); using stale cache")
            return json.loads(path.read_text())
        raise


def fetch_all(force: bool = False) -> dict[str, list[dict]]:
    """Fetch every group we need. Returns {'active': [...], 'debris': [...]}."""
    active, debris = [], []
    for g in ACTIVE_GROUPS:
        active += fetch_group(g, force)
    for g in DEBRIS_GROUPS:
        try:
            debris += fetch_group(g, force)
        except Exception as err:  # one bad group should not kill the pipeline
            print(f"[warn] skipping {g}: {err}")
    return {"active": active, "debris": debris}


if __name__ == "__main__":
    out = fetch_all()
    print({k: len(v) for k, v in out.items()})
