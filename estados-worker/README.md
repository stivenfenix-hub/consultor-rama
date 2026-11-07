# Servicio de estados electrónicos de Estradox

Revisa en el portal **Publicaciones Procesales** de la Rama Judicial los estados de los juzgados de todos los radicados vigilados. Corre en el VPS, no en Hostinger, por tres razones:
- el portal tarda minutos por búsqueda;
- usa su propia IP;
- así la app no se pone lenta.

Reutiliza el código de la app (`src/lib/estados.ts`), que es la misma lógica y la misma base de datos:

- **De noche (6:00 p.m. a 6:45 a.m., noches hábiles):** revisa cada juzgado una vez y lee solo su último estado.
- **De día:** revisa solo los juzgados pedidos, es decir, radicados recién agregados o el botón "Revisar ahora" del root.
- **Avisos:** lo que encuentra queda en la base y la app lo envía en el resumen de las 7 a.m. (correo, WhatsApp y notificación).

## Carpeta en el VPS (`/root/estradox`)

```
package.json          ← copia de estados-worker/package.json
prisma/schema.prisma
src/lib/estados.ts, db.ts, runtime-columns.ts, dias-habiles.ts
estados-worker/worker.ts
.env                  ← DATABASE_URL (la pega el dueño, nunca por chat) y los ajustes de abajo
```

Ajustes del `.env`, además de `DATABASE_URL`:

```
ESTRADOX_DB_POOL=2
ESTADOS_DESPACHOS_POR_CORRIDA=5
ESTADOS_PAUSA_MS=15000
```

## Instalar o actualizar

Ejecuta esto desde el computador, en la carpeta `consultor-rama`:

```bash
bash estados-worker/subir.sh
```

En el VPS, la primera vez:

```bash
cd /root/estradox && npm install --omit=dev
pm2 start "node --conditions=react-server --import tsx --env-file=.env estados-worker/worker.ts" --name estradox-estados
pm2 save
```

## Comandos útiles

```bash
pm2 logs estradox-estados      # ver qué juzgados revisa
pm2 restart estradox-estados
```
