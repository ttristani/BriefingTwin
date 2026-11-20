#!/usr/bin/env python3
"""Collecte METAR, TAF et NOTAM des terrains du programme -> data/wx.json.
Lancé par GitHub Actions toutes les 30 minutes. Bibliothèque standard uniquement."""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "briefing-twinjet/1.0 (GitHub Actions)"}


def http(url, data=None, headers=None, timeout=30):
    h = dict(UA)
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def icaos():
    prog = json.load(open(os.path.join(ROOT, "data", "programme.json"), encoding="utf-8"))
    s = set()
    for r in prog["rotations"]:
        for p in r["paires"]:
            for f in (p["aller"], p["retour"]):
                s.update([f["dpt"], f["arv"], *f["alt"]])
    return sorted(s)


def fetch_metar_taf(ids, errors):
    metar, taf = {}, {}
    q = ",".join(ids)
    try:
        for x in json.loads(http(f"https://aviationweather.gov/api/data/metar?ids={q}&format=json&hours=2")):
            metar.setdefault(x["icaoId"], []).append(x["rawOb"])
        for k in metar:
            metar[k].sort(key=lambda s: s.split()[2] if s.startswith(("METAR", "SPECI")) else s.split()[1], reverse=True)
    except Exception as e:  # noqa: BLE001
        errors.append(f"METAR: {e}")
    try:
        for x in json.loads(http(f"https://aviationweather.gov/api/data/taf?ids={q}&format=json")):
            taf.setdefault(x["icaoId"], x["rawTAF"])
    except Exception as e:  # noqa: BLE001
        errors.append(f"TAF: {e}")
    return metar, taf


def fetch_notam(icao, errors):
    out = []
    try:
        offset = 0
        while True:
            body = urllib.parse.urlencode({
                "searchType": "0", "designatorsForLocation": icao, "offset": str(offset),
                "notamsOnly": "false", "radius": "10"}).encode()
            j = json.loads(http("https://notams.aim.faa.gov/notamSearch/search", data=body,
                                headers={"Content-Type": "application/x-www-form-urlencoded",
                                         "Referer": "https://notams.aim.faa.gov/notamSearch/"}))
            lst = j.get("notamList") or []
            out += [" ".join((n.get("icaoMessage") or n.get("traditionalMessage") or "").split()) for n in lst]
            total = j.get("totalNotamCount") or len(out)
            offset += len(lst)
            if not lst or offset >= total or offset > 300:
                break
            time.sleep(0.5)
    except Exception as e:  # noqa: BLE001
        errors.append(f"NOTAM {icao}: {e}")
        return None
    return [n for n in out if n]


def main():
    ids = icaos()
    errors = []
    metar, taf = fetch_metar_taf(ids, errors)
    path = os.path.join(ROOT, "data", "wx.json")
    old = {}
    if os.path.exists(path):
        try:
            old = json.load(open(path, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            old = {}
    notam = {}
    for i in ids:
        n = fetch_notam(i, errors)
        # en cas d'échec, on garde les NOTAM précédents plutôt que rien
        notam[i] = n if n is not None else (old.get("notam") or {}).get(i, [])
        time.sleep(0.5)
    wx = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "metar": metar or old.get("metar", {}),
        "taf": taf or old.get("taf", {}),
        "notam": notam,
        "errors": errors,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(wx, f, ensure_ascii=False, indent=1)
    print(f"{len(metar)} METAR, {len(taf)} TAF, {sum(len(v) for v in notam.values())} NOTAM, {len(errors)} erreur(s)")
    for e in errors:
        print("  !", e)
    if not metar and not taf:
        sys.exit(1)


if __name__ == "__main__":
    main()
