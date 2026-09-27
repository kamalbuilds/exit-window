#!/bin/sh
# Seed the volume once from the image, then run the alarm worker and the site side by side.
set -e
mkdir -p /data/app-data /data/cache
if [ ! -f /data/.seeded ]; then
  cp -R /app/data-image/. /data/app-data/
  touch /data/.seeded
fi
# New seed responses shipped in later images are merged without overwriting runtime files.
cp -Rn /app/data-image/nansen-seed/. /data/app-data/nansen-seed/ 2>/dev/null || true
# Hyperliquid allows 1200 weight/min per IP; each process gets its own share (src/lib/hyperliquid.ts).
HL_WEIGHT_PER_MIN=150 ./node_modules/.bin/tsx scripts/alarm-worker.ts &
HL_WEIGHT_PER_MIN=600 ./node_modules/.bin/tsx scripts/sentinel.ts &
HL_WEIGHT_PER_MIN=400 exec ./node_modules/.bin/next start -p "${PORT:-3000}"
