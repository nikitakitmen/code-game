# Developing PROD on Windows 10/11

PROD runs the same everywhere; this guide is the Windows-first path using Docker
Desktop + WSL2. The real MySQL/Redis/Caddy/Next serve PROD itself — the in-game
MySQL/Redis/Nginx/… are only simulation entities computed in the browser.

## Prerequisites

1. **Windows 10 21H2+ or Windows 11.**
2. **WSL2** — in an admin PowerShell: `wsl --install`, then reboot.
3. **Docker Desktop** — install, and in *Settings → General* enable
   *Use the WSL 2 based engine*. In *Settings → Resources → WSL integration*
   enable your distro.
4. **Git** — `winget install Git.Git`.
5. (optional, for running the apps outside Docker) **Node 20+** and **PHP 8.3 + Composer**.

Clone the repo **inside WSL** (`\\wsl$`), not on the Windows filesystem — it is far faster:

```bash
wsl
git clone https://github.com/nikitakitmen/code-game.git
cd code-game
```

## Fastest path — everything in Docker

```bash
cp .env.example .env
# set DB_PASSWORD / DB_ROOT_PASSWORD to something non-default
docker compose build
docker compose run --rm --no-deps --entrypoint php api artisan key:generate --show
# paste the printed base64:… value into APP_KEY= in .env
docker compose up
```

Open <http://localhost> — you should see the PROD OS boot screen. The API is at
<http://localhost/api/health>. Migrations and the content seed run automatically on
first `api` start.

Stop with `Ctrl+C`; `docker compose down` removes the containers (volumes persist your DB).

## Running the apps directly (hot reload)

Useful when iterating on the frontend or engine.

**Backend (Laravel):**
```bash
cd apps/api
cp .env.example .env            # defaults to a local sqlite file — no DB server needed
composer install
php artisan key:generate
php artisan migrate --seed       # seeds the 100 missions etc. from ../../packages/content
php artisan serve                # http://localhost:8000
```

**Frontend (Next.js) + packages:**
```bash
# from the repo root
npm install
npm run dev                      # http://localhost:3000, proxies to the API at :8000
```

The engine and content are plain TypeScript workspaces (`packages/engine`,
`packages/content`) that both the web client and the backend seeder consume, so a
change to a mission JSON shows up in both after a rebuild.

## Tests

```bash
npm run test:engine     # simulation engine (determinism, formulas, campaign, saves)
npm run test:content    # content validation + playable Act I
npm run test:web        # store + window manager (jsdom)
cd apps/api && php artisan test   # API feature tests
npm run test:e2e        # Playwright campaign flow (needs a built web app)
```

## Common issues

| Symptom | Fix |
|---|---|
| `docker compose up` hangs on `api` | the DB wasn't ready — the entrypoint waits and retries; give it ~30s on first run |
| Fonts look like plain monospace offline | the retro fonts load from Google Fonts; they appear once you're online |
| Slow file watching | make sure the repo is under `\\wsl$`, not `C:\…` |
| Port 80 in use | set `HTTP_PORT=8080` in `.env` and open <http://localhost:8080> |
