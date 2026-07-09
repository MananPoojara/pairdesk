# Backend (Fastify + DuckDB) for PairDesk.
# Build context = repo root, so we can bundle the parquet market data.
FROM node:22-slim

WORKDIR /app

# Install backend deps (uses the lockfile for reproducible installs).
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# App code + the parquet data DuckDB reads at runtime.
COPY server/src ./src
COPY Data/parquet ./data/parquet

ENV NODE_ENV=production
ENV PORT=3002
ENV PARQUET_DIR=/app/data/parquet

EXPOSE 3002
CMD ["node", "src/index.js"]
