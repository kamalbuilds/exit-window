# Exit Window: Next.js site + Telegram alarm worker in one Fly machine, state on a volume at /data.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app /app
# Image copy of committed data (Nansen seed cache, call log) used to seed the volume on first boot.
RUN mv /app/data /app/data-image && rm -rf /app/.cache && ln -s /data/app-data /app/data && ln -s /data/cache /app/.cache
EXPOSE 3000
CMD ["sh", "deploy/start.sh"]
