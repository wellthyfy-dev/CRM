# Wellthyfy Outreach CRM — background worker (Render "Background Worker", Docker runtime).
# Build from the repository root:  docker build -f apps/worker/Dockerfile .
FROM node:22-bookworm-slim

# postgresql-client 17 from the PostgreSQL apt repo, so pg_dump matches Supabase's server version (nightly backups).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN npm ci --include=dev --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN npm run build -w @wellthyfy/worker

ENV NODE_ENV=production TZ=Asia/Kolkata PG_DUMP_PATH=/usr/bin/pg_dump
USER node
CMD ["node", "--enable-source-maps", "apps/worker/dist/index.js"]
