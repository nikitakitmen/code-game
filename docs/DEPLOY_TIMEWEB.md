# Deploying PROD to a VPS (Timeweb)

PROD ships as a Docker Compose stack: MySQL, Redis, the Laravel API (php-fpm), the
Next.js client, a queue worker, and a Caddy reverse proxy that serves everything on
port 80/443 and gets HTTPS automatically for a real domain.

## 1. Provision the VPS

On [Timeweb Cloud](https://timeweb.cloud) create a cloud server:

* **Image:** Ubuntu 24.04 LTS
* **Size:** 2 vCPU / 4 GB RAM / 40 GB is comfortable (1 vCPU / 2 GB works for a demo)
* Add your SSH key.

Point your domain's **A record** at the server's IP (`@` and `www`). Lower the TTL
a day ahead if you're migrating — the game will teach you why.

## 2. Install Docker

```bash
ssh root@YOUR_SERVER_IP
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
# Docker Compose v2 ships with Docker Engine; verify:
docker compose version
```

## 3. Get the code and configure

```bash
git clone -b claude/laughing-pascal-6es6fp https://github.com/nikitakitmen/code-game.git /opt/prod
cd /opt/prod
cp .env.example .env
```

Edit `.env`:

```ini
APP_ENV=production
APP_DEBUG=false
APP_URL=https://your-domain.tld
NEXT_PUBLIC_API_BASE=https://your-domain.tld/api/v1
CORS_ALLOWED_ORIGINS=https://your-domain.tld
DB_PASSWORD=<a long random string>
DB_ROOT_PASSWORD=<another long random string>
```

For automatic HTTPS, edit `docker/Caddyfile` and replace the first line `:80 {`
with your domain:

```caddyfile
your-domain.tld {
	encode gzip zstd
	…
}
```

Caddy will obtain and renew a Let's Encrypt certificate on its own (ports 80 and
443 must be open — Timeweb's firewall allows them by default).

## 4. Build and launch

```bash
docker compose build
docker compose run --rm --no-deps --entrypoint php api artisan key:generate --show
# paste the printed base64:… value into APP_KEY= in .env
docker compose up -d
```

First `api` start waits for MySQL, runs migrations, and seeds the 100 missions,
knowledge map and achievements from `packages/content`. Check it:

```bash
docker compose ps
curl -s https://your-domain.tld/api/health
docker compose logs -f api
```

Open `https://your-domain.tld` — the PROD OS boot screen should appear.

## 5. Backups

The DB lives in the `mysql-data` volume. A simple nightly dump:

```bash
# /etc/cron.d/prod-backup
0 3 * * * root cd /opt/prod && docker compose exec -T mysql \
  mysqldump -u root -p"$(grep DB_ROOT_PASSWORD .env | cut -d= -f2)" prod \
  | gzip > /opt/prod-backups/prod-$(date +\%F).sql.gz
```

Keep backups **off the box** (Timeweb S3-compatible storage, or `rsync` elsewhere) —
the game will also teach you why a backup you've never restored is only a guess.

## 6. Updating

```bash
cd /opt/prod
git pull
docker compose build
docker compose up -d        # entrypoint re-runs migrations; content re-seeds idempotently
```

## Operations cheatsheet

| Task | Command |
|---|---|
| Logs | `docker compose logs -f [api\|web\|caddy\|worker]` |
| Shell in the API | `docker compose exec api sh` |
| Re-run migrations | `docker compose exec api php artisan migrate --force` |
| Re-seed content | `docker compose exec api php artisan db:seed --force` |
| Restart one service | `docker compose restart web` |
| Tear down (keep data) | `docker compose down` |
| Tear down + wipe data | `docker compose down -v` |

## Notes

* Only Caddy exposes ports to the internet; MySQL, Redis, the API and the web
  client talk over the private compose network. Never publish 3306 or 6379 — the
  Security chapter in-game is about exactly this class of mistake.
* Set strong `DB_PASSWORD`/`DB_ROOT_PASSWORD` and keep `.env` out of Git (it is in
  `.gitignore`). Rotate anything that leaks.
