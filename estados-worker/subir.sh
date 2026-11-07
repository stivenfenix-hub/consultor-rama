#!/usr/bin/env bash
# Copia el servicio de estados al VPS (desde la carpeta consultor-rama).
# No toca el .env del VPS. Después: npm install (si cambió package.json) y pm2 restart.
set -euo pipefail
VPS="${VPS:-root@179.66.137.82}"
DEST=/root/estradox
ssh -o BatchMode=yes "$VPS" "mkdir -p $DEST/prisma $DEST/src/lib $DEST/estados-worker"
scp -q -o BatchMode=yes estados-worker/package.json "$VPS:$DEST/package.json"
scp -q -o BatchMode=yes prisma/schema.prisma "$VPS:$DEST/prisma/schema.prisma"
scp -q -o BatchMode=yes src/lib/estados.ts src/lib/db.ts src/lib/runtime-columns.ts src/lib/dias-habiles.ts "$VPS:$DEST/src/lib/"
scp -q -o BatchMode=yes estados-worker/worker.ts estados-worker/README.md "$VPS:$DEST/estados-worker/"
echo "Copiado a $VPS:$DEST"
