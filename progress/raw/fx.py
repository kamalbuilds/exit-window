import json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
def get(p):
    try:
        t = json.load(urllib.request.urlopen(f"https://api.fxtwitter.com/{p}", timeout=20))["tweet"]
    except Exception as e:
        return {"url": p, "error": str(e)}
    raw = t.get("raw_text") or {}
    return {"url": t["url"], "author": t["author"]["screen_name"], "followers": t["author"].get("followers"),
            "date": t.get("created_at"), "likes": t.get("likes"), "views": t.get("views"),
            "text": raw.get("text") or t.get("text"),
            "links": [f.get("replacement") for f in raw.get("facets", []) if f.get("type") == "url"]}
paths = [l.strip() for l in open(sys.argv[1]) if l.strip()]
with ThreadPoolExecutor(8) as ex:
    for r in ex.map(get, paths): print(json.dumps(r))
