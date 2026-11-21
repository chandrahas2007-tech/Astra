#!/usr/bin/env python3
"""Build research data for the Satellite Tracker (stdlib only).
Run after build_data.py:  python build_research.py
Reads data/satellites.json + data/stats.json, writes data/research.json + data/research-report.md"""
import json, math, os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
R, MU = 6378.137, 398600.4418      # km, km^3/s^2
KEPLER_TOL = 0.005                 # 0.5 % period tolerance
KEPLER_MIN_RATE = 0.98


def read(*p):
    with open(os.path.join(HERE, *p), encoding="utf-8") as f:
        return json.load(f)


def kepler_period_min(perigee, apogee):
    a = (perigee + apogee) / 2 + R
    return 2 * math.pi * math.sqrt(a ** 3 / MU) / 60


def run_checks(sats, stats):
    checks = []
    def add(cid, name, ok, detail):
        checks.append({"id": cid, "name": name, "pass": bool(ok), "detail": detail})

    n_sum = stats["active"] + stats["inactive"] + stats.get("unknown", 0)
    add("counts", "Status counts add up to the total",
        stats["total"] == n_sum == len(sats),
        f"stats total {stats['total']}, active+inactive+unknown {n_sum}, rows {len(sats)}")

    ids = [s["id"] for s in sats]
    add("unique-ids", "Every NORAD ID appears once", len(ids) == len(set(ids)),
        f"{len(ids) - len(set(ids))} duplicate IDs")

    both = [s for s in sats if s.get("perigee") is not None and s.get("apogee") is not None]
    bad = [s for s in both if s["perigee"] > s["apogee"]]
    add("perigee-apogee", "Perigee is never above apogee", not bad,
        f"{len(bad)} of {len(both)} rows with both values")

    rows = [s for s in both if s.get("period") and s["perigee"] >= 100]
    out = []
    for s in rows:
        k = kepler_period_min(s["perigee"], s["apogee"])
        err = abs(k - s["period"]) / s["period"]
        if err > KEPLER_TOL:
            out.append({"id": s["id"], "name": s["name"], "period": s["period"],
                        "kepler": round(k, 1), "error_pct": round(err * 100, 2)})
    rate = 1 - len(out) / len(rows) if rows else 0
    out.sort(key=lambda o: -o["error_pct"])
    add("kepler", "Reported period matches Kepler's third law from perigee and apogee",
        rows and rate >= KEPLER_MIN_RATE,
        f"{len(rows) - len(out)} of {len(rows)} within {KEPLER_TOL*100:.1f}% ({rate*100:.1f}%). "
        f"Largest mismatches: {', '.join(o['name'] + ' (' + str(o['error_pct']) + '%)' for o in out[:3]) or 'none'}")
    return checks


def main():
    sats, stats = read("data", "satellites.json"), read("data", "stats.json")
    checks = run_checks(sats, stats)
    by_id = {c["id"]: c for c in checks}
    findings = read("research", "findings.json")
    for f in findings:
        c = by_id.get(f.get("auto_check"))
        if c:
            f["status"] = "cross-checked" if c["pass"] else "unverified"
            f["evidence"] = ("Passed: " if c["pass"] else "FAILED: ") + c["detail"]
    mods = []
    for fn in sorted(os.listdir(os.path.join(HERE, "research", "modules"))):
        if fn.endswith(".md"):
            with open(os.path.join(HERE, "research", "modules", fn), encoding="utf-8") as m:
                mods.append({"slug": fn[:-3], "title": m.readline().lstrip("# ").strip()})
    withorb = sum(1 for s in sats if s.get("perigee") is not None and s.get("period"))
    out = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "source": stats.get("source"), "catalogue_updated": stats.get("updated"),
           "summary": {"total": stats["total"], "active": stats["active"], "inactive": stats["inactive"],
                       "unknown": stats.get("unknown", 0),
                       "orbit_data_coverage_pct": round(100 * withorb / max(len(sats), 1), 1)},
           "checks": checks, "findings": findings, "modules": mods}
    with open(os.path.join(HERE, "data", "research.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    L = ["# Satellite Tracker research report", "",
         f"Generated {out['generated']}. Catalogue: {out['source']}, fetched {out['catalogue_updated']}.",
         f"Payloads: {stats['total']} (active {stats['active']}, inactive {stats['inactive']}, unknown {stats.get('unknown', 0)}).", ""]
    if out["source"] != "celestrak":
        L += ["> Warning: data did not come from CelesTrak. Do not cite these numbers.", ""]
    L += ["## Data checks", ""] + [f"- {'PASS' if c['pass'] else 'FAIL'}: {c['name']}. {c['detail']}" for c in checks]
    L += ["", "## Findings", ""]
    for f in findings:
        src = ", ".join(f"{x['label']} <{x['url']}>" for x in f["sources"]) or "none"
        L += [f"### {f['title']} [{f['status']}]", "", f["claim"], "", f"- Method: {f['method']}",
              f"- Limitations: {f['limitations']}", f"- Sources: {src}", ""]
    with open(os.path.join(HERE, "data", "research-report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    print("checks:", {c["id"]: c["pass"] for c in checks})


if __name__ == "__main__":
    main()
