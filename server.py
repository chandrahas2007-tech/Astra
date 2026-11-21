#!/usr/bin/env python3
"""
Satellite Tracker Backend
Python 3.8+

Run:
    python server.py

Open:
    http://localhost:8000

[ASTRA patch] marks the lines changed to connect this server with the
data-integration pipeline (data/dashboard.json) and the page loader (astra-data.js).
"""

import csv
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen

PORT = int(os.environ.get("PORT", 8000))
HERE = os.path.dirname(os.path.abspath(__file__))

URL = "https://celestrak.org/pub/satcat.csv"
CACHE_SECONDS = 6 * 3600
RETRY_SECONDS = 15 * 60  # [ASTRA patch] wait this long after a failed download

ACTIVE_CODES = {"+", "P", "B", "S", "X"}

# [ASTRA patch] the only extra files the server may hand out (no open file access)
STATIC_FILES = {
    "/astra-data.js": ("astra-data.js", "text/javascript; charset=utf-8"),
    "/data/dashboard.json": ("data/dashboard.json", "application/json; charset=utf-8"),
}

_lock = threading.Lock()

_cache = {
    "t": 0,
    "rows": [],
    "source": "none",
    "retry_at": 0,  # [ASTRA patch]
}


def classify(code):
    code = (code or "").strip().upper()

    if code in ACTIVE_CODES:
        return "active"

    if code == "-":
        return "inactive"

    return "unknown"


def num(value):
    try:
        return round(float(value), 1)
    except (ValueError, TypeError):
        return None


def parse_satcat(text):
    """Parse CelesTrak SATCAT CSV."""

    rows = []

    reader = csv.DictReader(io.StringIO(text))

    for raw in reader:

        # Normalize column names and values
        r = {
            (k or "").strip().upper(): (v or "").strip()
            for k, v in raw.items()
        }

        object_type = r.get("OBJECT_TYPE", "").upper()

        # SATCAT commonly uses PAYLOAD, not PAY.
        if object_type not in ("PAYLOAD", "PAY"):
            continue

        # Ignore objects that have already decayed.
        if r.get("DECAY_DATE"):
            continue

        # Only Earth orbit.
        orbit_center = r.get("ORBIT_CENTER", "EA").upper()

        if orbit_center not in ("EA", "EARTH", ""):
            continue

        norad_id = r.get("NORAD_CAT_ID", "")

        if not norad_id:
            continue

        rows.append({
            "name": r.get("OBJECT_NAME", "Unknown"),
            "id": norad_id,
            "intl": r.get("OBJECT_ID", ""),
            "status": classify(r.get("OPS_STATUS_CODE")),
            "code": r.get("OPS_STATUS_CODE", ""),
            "owner": r.get("OWNER", ""),
            "launch": r.get("LAUNCH_DATE", ""),
            "period": num(r.get("PERIOD")),
            "inc": num(r.get("INCLINATION")),
            "apogee": num(r.get("APOGEE")),
            "perigee": num(r.get("PERIGEE")),
            "orbit": r.get("ORBIT_TYPE", ""),
        })

    return rows


def load():

    with _lock:

        now = time.time()

        # Use cache if fresh
        if _cache["rows"] and now - _cache["t"] < CACHE_SECONDS:
            return _cache

        # [ASTRA patch] after a failed download, do not retry on every request
        # (CelesTrak blocks clients that download too often)
        if now < _cache["retry_at"]:
            return _cache

        try:

            print("Downloading satellite catalogue...")

            req = Request(
                URL,
                headers={
                    "User-Agent": "Mozilla/5.0 SatelliteTracker/1.0"
                }
            )

            with urlopen(req, timeout=45) as response:
                text = response.read().decode(
                    "utf-8",
                    errors="replace"
                )

            rows = parse_satcat(text)

            if not rows:
                raise ValueError(
                    "No payload records found. "
                    "Check the SATCAT CSV format."
                )

            _cache.update({
                "t": time.time(),
                "rows": rows,
                "source": "celestrak",
                "retry_at": 0,
            })

            print(f"Loaded {len(rows)} payloads")

        except Exception as error:

            print("Catalogue download failed:", error)

            _cache["retry_at"] = time.time() + RETRY_SECONDS  # [ASTRA patch]

            # Retain previous valid data
            if _cache["rows"]:
                print("Using previous cached data")

            else:
                # [ASTRA patch] t stays 0 so the API reports "Unavailable"
                _cache.update({
                    "rows": [],
                    "source": "unavailable",
                })

        return _cache


def stats():

    data = load()
    rows = data["rows"]

    result = {
        "source": data["source"],
        "updated": (
            time.strftime(
                "%Y-%m-%d %H:%M UTC",
                time.gmtime(data["t"])
            )
            if data["t"]
            else "Unavailable"
        ),

        "total": len(rows),
        "active": 0,
        "inactive": 0,
        "unknown": 0,
        "owners": {},
    }

    for satellite in rows:

        status = satellite["status"]

        result[status] += 1

        owner = satellite["owner"] or "Unknown"

        if owner not in result["owners"]:
            result["owners"][owner] = {
                "active": 0,
                "inactive": 0,
                "unknown": 0,
            }

        result["owners"][owner][status] += 1

    # Top 10 countries/operators
    owners = sorted(
        result["owners"].items(),
        key=lambda item: sum(item[1].values()),
        reverse=True,
    )[:10]

    result["owners"] = [
        {
            "owner": name,
            **counts,
        }
        for name, counts in owners
    ]

    return result


def query(params):

    rows = load()["rows"]

    status = params.get("status", ["all"])[0]
    search = params.get("q", [""])[0].lower().strip()
    owner = params.get("owner", [""])[0].strip().upper()

    try:
        page = max(int(params.get("page", ["1"])[0]), 1)
    except ValueError:
        page = 1

    try:
        size = int(params.get("size", ["50"])[0])
    except ValueError:
        size = 50

    size = min(max(size, 1), 200)

    filtered = []

    for satellite in rows:

        if status != "all" and satellite["status"] != status:
            continue

        if owner and satellite["owner"].upper() != owner:
            continue

        if search:

            searchable = (
                satellite["name"].lower()
                + satellite["id"]
                + satellite["intl"].lower()
            )

            if search not in searchable:
                continue

        filtered.append(satellite)

    start = (page - 1) * size

    return {
        "total": len(filtered),
        "page": page,
        "size": size,
        "items": filtered[start:start + size],
    }


class Handler(BaseHTTPRequestHandler):

    def send_json(self, code, data):

        body = json.dumps(data).encode("utf-8")

        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        self.wfile.write(body)

    def send_static(self, rel_path, content_type):
        """[ASTRA patch] serve one whitelisted file from next to server.py."""

        try:
            with open(os.path.join(HERE, rel_path), "rb") as file:
                body = file.read()
        except FileNotFoundError:
            return self.send_json(404, {"error": rel_path + " not found"})

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        self.wfile.write(body)

    def do_GET(self):

        url = urlparse(self.path)

        try:

            if url.path == "/api/stats":
                return self.send_json(200, stats())

            if url.path == "/api/satellites":
                return self.send_json(
                    200,
                    query(parse_qs(url.query))
                )

            if url.path in STATIC_FILES:  # [ASTRA patch]
                rel_path, content_type = STATIC_FILES[url.path]
                return self.send_static(rel_path, content_type)

            if url.path in ("/", "/index.html"):

                path = os.path.join(HERE, "index.html")

                with open(path, "rb") as file:
                    body = file.read()

                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "text/html; charset=utf-8"
                )
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()

                self.wfile.write(body)
                return

            return self.send_json(
                404,
                {"error": "Endpoint not found"}
            )

        except Exception as error:

            print("API error:", error)

            return self.send_json(
                500,
                {"error": str(error)}
            )

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args))


if __name__ == "__main__":

    print("Starting Satellite Tracker...")
    load()

    print(f"Server running at http://localhost:{PORT}")

    server = ThreadingHTTPServer(
        ("0.0.0.0", PORT),
        Handler
    )

    server.serve_forever()
