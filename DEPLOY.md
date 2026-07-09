# PairDesk — Free Hosting Guide

Your app has 3 parts, so it needs 3 free services:

| Part | What it is | Host | Card needed? |
|------|-----------|------|--------------|
| **Frontend** (`web/`) | React static site | **Vercel** | No |
| **Backend** (`server/`) | Fastify + DuckDB + Parquet | **Fly.io** (or Render) | Fly: yes¹ / Render: no |
| **Database** | Postgres (clients, trades…) | **Neon** | No |

¹ Fly asks for a card but won't charge inside the free allowance. If you want **zero card**, use Render for the backend (needs a quick GitHub repo instead — see bottom).

Do the steps **in order**: Database → Backend → Frontend (frontend needs the backend URL).

---

## 1. Database — Neon (free, no card)

1. Go to https://neon.tech → sign up → **Create project**.
2. Copy the **connection string** (looks like `postgresql://user:pass@ep-xxx.neon.tech/dbname?sslmode=require`).
3. Load the schema + data from your machine (needs Python with `pandas` + `psycopg2-binary`):

```bash
cd /home/dexter/Downloads/PairTrading_algo

export DATABASE_URL='postgresql://...your neon string...'

# create tables
psql "$DATABASE_URL" -f db/schema.sql

# load clients/trades/pnl from the Excel source
pip install pandas psycopg2-binary openpyxl   # once
python3 Data/ingest_pnl.py
```

Verify: `psql "$DATABASE_URL" -c "SELECT count(*) FROM trades;"` should return a number.

---

## 2. Backend — Fly.io (CLI, no GitHub)

```bash
cd /home/dexter/Downloads/PairTrading_algo

# install the CLI (once)
curl -L https://fly.io/install.sh | sh

fly auth signup          # or: fly auth login

# pick a unique app name — edit the `app = "..."` line in fly.toml first
fly launch --no-deploy --copy-config --name YOUR-UNIQUE-NAME

# give it the database
fly secrets set DATABASE_URL='postgresql://...your neon string...'

fly deploy
```

When it finishes, note the URL: `https://YOUR-UNIQUE-NAME.fly.dev`
Test it: `curl https://YOUR-UNIQUE-NAME.fly.dev/health` → should show `{"status":"ok",...}`

---

## 3. Frontend — Vercel (CLI, no GitHub)

1. Put your backend URL into `web/vercel.json` — replace `REPLACE_WITH_BACKEND_URL`
   with `YOUR-UNIQUE-NAME.fly.dev` (no `https://`, no trailing slash).

```bash
cd /home/dexter/Downloads/PairTrading_algo/web

npm i -g vercel      # once
vercel               # first run: log in + link project, accept defaults
vercel --prod        # deploys to your live URL
```

Vercel prints your live site, e.g. `https://web-xxxx.vercel.app`. Open it — done.

> The `/api/...` calls the site makes are transparently forwarded to your Fly backend
> by the rewrite in `vercel.json`, so the browser only ever talks to one origin (no CORS).

---

## Zero-card alternative for the backend — Render

Render is 100% free (no card) but pulls from a Git repo instead of local CLI:

1. Create a repo (GitHub/GitLab) and push this project.
2. https://render.com → **New → Web Service** → pick the repo.
3. Settings: **Runtime = Docker**, **Dockerfile path = `./Dockerfile`**.
4. Add env var `DATABASE_URL` = your Neon string.
5. Create. Use the resulting `https://xxx.onrender.com` as your backend URL in step 3.

Note: Render free sleeps after 15 min idle → first request takes ~30s to wake. Fine for a demo.

---

## What I changed to make this deployable
- `server/package.json` — added the DuckDB package the code actually uses (`@duckdb/node-api`) and removed 3 unused native packages that would have crashed the cloud build.
- `server/src/db/pg.js` — now uses `DATABASE_URL` (with SSL) in the cloud, local Docker otherwise.
- `server/src/db/duck.js` — Parquet path is now configurable via `PARQUET_DIR`.
- `Data/ingest_pnl.py` — can seed a cloud DB via `DATABASE_URL`.
- Added `Dockerfile`, `.dockerignore`, `fly.toml`, `web/vercel.json`.
