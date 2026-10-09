#!/usr/bin/env sh
# Copia de seguridad de la base de datos (reservas, flujos y credenciales cifradas).
# Cron diario en el servidor:  0 4 * * * cd /opt/reservas-n8n && ./scripts/backup.sh
set -eu
mkdir -p backups
FICHERO="backups/n8n-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T postgres pg_dump -U n8n n8n | gzip > "$FICHERO"
# Conserva las últimas 14 copias.
ls -1t backups/n8n-*.sql.gz | tail -n +15 | xargs -r rm --
echo "Copia guardada en $FICHERO"
