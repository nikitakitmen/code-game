#!/bin/sh
set -e
cd /var/www/html

# Wait for the database, then migrate + seed once (idempotent).
if [ "$1" = "php-fpm" ]; then
  echo "Waiting for database…"
  until php -r "new PDO('mysql:host='.getenv('DB_HOST').';port='.getenv('DB_PORT'), getenv('DB_USERNAME'), getenv('DB_PASSWORD'));" 2>/dev/null; do
    sleep 2
  done
  [ -z "$(php artisan tinker --execute='echo config("app.key");' 2>/dev/null)" ] && php artisan key:generate --force || true
  php artisan migrate --force
  php artisan db:seed --force || true
  php artisan config:cache || true
  php artisan route:cache || true
  # artisan ran as root; php-fpm runs as www-data and must be able to write logs/cache
  chown -R www-data:www-data storage bootstrap/cache
fi

exec "$@"
