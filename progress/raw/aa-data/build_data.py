#!/usr/bin/env python3
"""
Nansen Whale Radar — Data Builder
Fetches live data from Nansen public points-leaderboard API (no key needed)
and builds the data payload for the radar app.
"""
import json, os, urllib.request
from datetime import datetime, timezone, timedelta

RIYADH_TZ = timezone(timedelta(hours=3))
API = "https://app.nansen.ai/api/points-leaderboard"
OUT_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(OUT_DIR, exist_ok=True)

TIER_COLORS = {"Star": "#FFD700", "North": "#4FC3F7", "Ice": "#80DEEA", "Green": "#81C784", "Unranked": "#9E9E9E"}

def fetch():
    req = urllib.request.Request(API, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def main():
    now = datetime.now(RIYADH_TZ)
    stamp = now.strftime("%Y-%m-%d %H:%M")
    day = now.strftime("%Y-%m-%d")
    print(f"📡 Fetching leaderboard @ {stamp} Riyadh...")
    data = fetch()
    total_pts = sum(u["points"] for u in data)
    tiers = {}
    for u in data:
        tiers[u.get("tier", "?")] = tiers.get(u.get("tier", "?"), 0) + 1
    print(f"✅ {len(data):,} wallets | {total_pts:,} pts | tiers={tiers}")

    whales = [u for u in data if u.get("tier") in ("Star", "North", "Ice")]
    whales.sort(key=lambda x: -x["points"])

    payload = {
        "fetched_at": stamp,
        "total_wallets": len(data),
        "total_points": total_pts,
        "tiers": tiers,
        "whales": [
            {
                "address": (u.get("evm_address") or u.get("solana_address") or "?"),
                "points": u["points"],
                "rank": u.get("rank", 0),
                "tier": u.get("tier", "?"),
            }
            for u in whales[:600]  # radar blips: top 600 whales
        ],
    }
    out = os.path.join(OUT_DIR, f"radar_{day.replace('-','')}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"💾 Saved {out} ({len(payload['whales'])} whale blips)")

if __name__ == "__main__":
    main()
