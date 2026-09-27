"""
Buildathon Call Meter — يجمع بيانات حقيقية للرادار + يعد الـ API calls
كل call يخدم غرضين: (1) بيانات للـ Whale Radar (2) يعدّ من الـ 1,000 المطلوبة
"""
import json, os, time, urllib.request
from datetime import datetime, timezone, timedelta

RIYADH_TZ = timezone(timedelta(hours=3))
API_KEY = "nsn_8c7f197d573b2ebe4cbe76859eeebfa0"
BASE = "https://api.nansen.ai/api/v1"
METER_FILE = "C:/Users/aasun/nansen-whale-radar/buildathon_meter.json"
OUT_DIR = "C:/Users/aasun/nansen-whale-radar/data"
os.makedirs(OUT_DIR, exist_ok=True)

def api(endpoint, payload):
    url = f"{BASE}/{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", "apiKey": API_KEY}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read())
        used = resp.headers.get("x-nansen-credits-used")
        remaining = resp.headers.get("x-nansen-credits-remaining")
    return body, used, remaining

def load_meter():
    if os.path.exists(METER_FILE):
        with open(METER_FILE) as f:
            return json.load(f)
    return {"calls": 0, "credits_used": 0, "log": []}

def save_meter(m):
    with open(METER_FILE, "w") as f:
        json.dump(m, f, indent=1)

def run(batches=6, per_page=20):
    m = load_meter()
    now = datetime.now(RIYADH_TZ)
    stamp = now.strftime("%Y-%m-%d %H:%M")
    chains = ["ethereum", "solana"]
    
    flows = []
    for i in range(batches):
        chain = chains[i % 2]
        try:
            body, used, rem = api("smart-money/netflow", {
                "chains": [chain], "pagination": {"page": 1 + i // 2, "per_page": per_page}
            })
            m["calls"] += 1
            m["credits_used"] += int(used or 0)
            results = body.get("data", [])
            for t in results:
                flows.append({
                    "chain": chain,
                    "token": t.get("token_symbol", "?"),
                    "addr": t.get("token_address", ""),
                    "net_24h": round(t.get("net_flow_24h_usd", 0)),
                    "net_7d": round(t.get("net_flow_7d_usd", 0)),
                    "traders": t.get("trader_count", 0),
                })
            m["log"].append({"t": stamp, "ep": "netflow", "chain": chain, "n": len(results), "rem": rem})
            print(f"  [{m['calls']}] netflow/{chain}: {len(results)} tokens | credits left: {rem}")
        except Exception as e:
            print(f"  ⚠️ netflow/{chain}: {e}")
        time.sleep(1.2)
        save_meter(m)
    
    # Save flows payload for radar extra layer
    if flows:
        day = now.strftime("%Y%m%d")
        path = os.path.join(OUT_DIR, f"flows_{day}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"fetched_at": stamp, "flows": flows}, f, ensure_ascii=False)
        print(f"💾 flows saved: {path} ({len(flows)} entries)")
    
    print(f"\n📊 METER: {m['calls']}/1000 calls | credits used: {m['credits_used']}")
    return m

if __name__ == "__main__":
    run()
