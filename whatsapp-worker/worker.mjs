// Servicio de WhatsApp de Estradox.
//
// Corre en un servidor aparte (un solo proceso, siempre encendido). Mantiene
// vinculados los WhatsApp de Estradox como "dispositivos vinculados" (igual que
// WhatsApp Web) y envía, despacio, los mensajes que Estradox deja en la cola:
//   - cuenta "avisos":    actuaciones nuevas y avisos de pago.
//   - cuenta "comercial": quienes no han cargado procesos y promociones.
// Todo se maneja desde el root de Estradox (Panel admin → WhatsApp): el QR, el
// estado, pausar, desvincular y el máximo por día viven en la base de datos.
//
// Variables de entorno:
//   DATABASE_URL   la misma base de datos de Estradox (obligatoria)
//   WA_PAUSA_MIN   segundos mínimos entre mensajes (por defecto 25)
//   WA_PAUSA_MAX   segundos máximos entre mensajes (por defecto 70)

import { createRequire } from "node:module";
import pg from "pg";
import pino from "pino";

const require = createRequire(import.meta.url);
const baileys = require("@whiskeysockets/baileys");
const makeWASocket = baileys.default;
const { BufferJSON, DisconnectReason, initAuthCreds, fetchLatestBaileysVersion, proto } = baileys;

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const CUENTAS = ["avisos", "comercial"];
const PAUSA_MIN = Number(process.env.WA_PAUSA_MIN ?? 25);
const PAUSA_MAX = Number(process.env.WA_PAUSA_MAX ?? 70);
const HORA_DESDE = 8 * 60; // 8:00 a.m. Bogotá
const HORA_HASTA = 20 * 60; // 8:00 p.m. Bogotá
const MAX_INTENTOS = 3;

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
});
const q = (sql, params) => pool.query(sql, params);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Tablas (las mismas que crea Estradox; IF NOT EXISTS) ----------
async function asegurarTablas() {
  await q(`CREATE TABLE IF NOT EXISTS "WaSesion" (
    cuenta TEXT NOT NULL,
    clave TEXT NOT NULL,
    valor TEXT NOT NULL,
    PRIMARY KEY (cuenta, clave)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS "WaEstado" (
    cuenta TEXT PRIMARY KEY,
    estado TEXT NOT NULL DEFAULT 'apagado',
    qr TEXT,
    numero TEXT,
    pausado BOOLEAN NOT NULL DEFAULT false,
    "maxDia" INTEGER NOT NULL DEFAULT 40,
    comando TEXT,
    "ultimoError" TEXT,
    "actualizadoAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "workerVistoAt" TIMESTAMPTZ
  )`);
  for (const c of CUENTAS) {
    await q(`INSERT INTO "WaEstado" (cuenta) VALUES ($1) ON CONFLICT DO NOTHING`, [c]);
  }
  await q(`CREATE TABLE IF NOT EXISTS "WaMensaje" (
    id SERIAL PRIMARY KEY,
    cuenta TEXT NOT NULL,
    "userId" TEXT,
    tipo TEXT NOT NULL,
    telefono TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    intentos INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "enviadoAt" TIMESTAMPTZ
  )`);
  await q(
    `CREATE INDEX IF NOT EXISTS "WaMensaje_pendiente_idx" ON "WaMensaje" (cuenta, id) WHERE estado = 'pendiente'`,
  );
}

function minutosBogota() {
  const b = new Date(Date.now() - 5 * 3600_000);
  return b.getUTCHours() * 60 + b.getUTCMinutes();
}

/** Una cuenta de WhatsApp: su conexión, su sesión y su cola. */
function crearCuenta(cuenta) {
  const clog = log.child({ cuenta });
  let sock = null;
  let conectado = false;
  let reconectando = false;

  const guardarEstado = async (campos) => {
    const claves = Object.keys(campos);
    const sets = claves.map((k, i) => `"${k}" = $${i + 2}`).join(", ");
    await q(
      `UPDATE "WaEstado" SET ${sets}, "actualizadoAt" = now() WHERE cuenta = $1`,
      [cuenta, ...claves.map((k) => campos[k])],
    );
  };
  const leerEstado = async () =>
    (await q(`SELECT * FROM "WaEstado" WHERE cuenta = $1`, [cuenta])).rows[0];
  const borrarSesion = () => q(`DELETE FROM "WaSesion" WHERE cuenta = $1`, [cuenta]);

  // Sesión guardada en la base de datos (como useMultiFileAuthState de Baileys):
  // un reinicio del servidor no pide escanear el QR otra vez.
  async function sesion() {
    const leer = async (clave) => {
      const r = await q(`SELECT valor FROM "WaSesion" WHERE cuenta = $1 AND clave = $2`, [cuenta, clave]);
      return r.rows[0] ? JSON.parse(r.rows[0].valor, BufferJSON.reviver) : null;
    };
    const escribir = (clave, valor) =>
      q(
        `INSERT INTO "WaSesion" (cuenta, clave, valor) VALUES ($1, $2, $3)
         ON CONFLICT (cuenta, clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [cuenta, clave, JSON.stringify(valor, BufferJSON.replacer)],
      );
    const borrar = (clave) => q(`DELETE FROM "WaSesion" WHERE cuenta = $1 AND clave = $2`, [cuenta, clave]);

    const creds = (await leer("creds")) ?? initAuthCreds();
    return {
      state: {
        creds,
        keys: {
          get: async (tipo, ids) => {
            const datos = {};
            await Promise.all(
              ids.map(async (id) => {
                let valor = await leer(`${tipo}-${id}`);
                if (tipo === "app-state-sync-key" && valor) {
                  valor = proto.Message.AppStateSyncKeyData.fromObject(valor);
                }
                datos[id] = valor;
              }),
            );
            return datos;
          },
          set: async (datos) => {
            const tareas = [];
            for (const tipo in datos) {
              for (const id in datos[tipo]) {
                const valor = datos[tipo][id];
                const clave = `${tipo}-${id}`;
                tareas.push(valor ? escribir(clave, valor) : borrar(clave));
              }
            }
            await Promise.all(tareas);
          },
        },
      },
      guardarCreds: () => escribir("creds", creds),
    };
  }

  async function conectar() {
    const { state, guardarCreds } = await sesion();
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    sock = makeWASocket({
      auth: state,
      version,
      logger: clog.child({ mod: "baileys" }, { level: "warn" }),
      browser: [cuenta === "avisos" ? "Estradox Avisos" : "Estradox Comercial", "Chrome", "1.0"],
      printQRInTerminal: false,
      markOnlineOnConnect: false, // que el teléfono siga recibiendo notificaciones
      syncFullHistory: false,
    });
    sock.ev.on("creds.update", guardarCreds);
    sock.ev.on("connection.update", async (u) => {
      try {
        if (u.qr) {
          clog.info("QR nuevo: escanéalo desde Panel admin → WhatsApp");
          await guardarEstado({ estado: "qr", qr: u.qr, ultimoError: null });
        }
        if (u.connection === "open") {
          conectado = true;
          const numero = (sock.user?.id ?? "").split(":")[0].split("@")[0];
          clog.info({ numero }, "WhatsApp conectado");
          await guardarEstado({ estado: "conectado", qr: null, numero, ultimoError: null });
        }
        if (u.connection === "close") {
          conectado = false;
          const codigo = u.lastDisconnect?.error?.output?.statusCode;
          const cerroSesion = codigo === DisconnectReason.loggedOut;
          clog.warn({ codigo }, "WhatsApp desconectado");
          if (cerroSesion) {
            // Se desvinculó desde el teléfono: se borra la sesión y sale un QR nuevo.
            await borrarSesion();
            await guardarEstado({ estado: "desvinculado", qr: null, numero: null });
          } else {
            await guardarEstado({ estado: "reconectando", ultimoError: `Conexión cerrada (${codigo ?? "?"})` });
          }
          reconectar(cerroSesion ? 2_000 : 5_000);
        }
      } catch (e) {
        clog.error(e, "connection.update");
      }
    });
  }

  function reconectar(ms) {
    if (reconectando) return;
    reconectando = true;
    setTimeout(async () => {
      reconectando = false;
      try {
        await conectar();
      } catch (e) {
        clog.error(e, "no se pudo reconectar");
        reconectar(30_000);
      }
    }, ms);
  }

  /** Latido para el root y comandos (desvincular). */
  async function latido() {
    try {
      const e = await leerEstado();
      await q(`UPDATE "WaEstado" SET "workerVistoAt" = now() WHERE cuenta = $1`, [cuenta]);
      if (e?.comando === "desvincular") {
        await guardarEstado({ comando: null });
        clog.info("Desvincular pedido desde el root");
        conectado = false;
        if (sock) await sock.logout().catch(() => {});
        await borrarSesion();
        await guardarEstado({ estado: "desvinculado", qr: null, numero: null });
        reconectar(2_000);
      }
    } catch (e) {
      clog.error(e, "latido");
    }
  }

  const enviadosHoy = async () =>
    (
      await q(
        `SELECT count(*)::int AS n FROM "WaMensaje"
         WHERE cuenta = $1 AND estado = 'enviado'
           AND ("enviadoAt" AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date`,
        [cuenta],
      )
    ).rows[0].n;

  /** Toma el siguiente pendiente (lo marca 'enviando' para no tomarlo dos veces). */
  const tomarSiguiente = async () =>
    (
      await q(
        `UPDATE "WaMensaje" SET estado = 'enviando', intentos = intentos + 1
         WHERE id = (SELECT id FROM "WaMensaje" WHERE cuenta = $1 AND estado = 'pendiente'
                     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id, telefono, mensaje, intentos`,
        [cuenta],
      )
    ).rows[0] ?? null;

  async function enviarUno(m) {
    const numero = m.telefono.replace(/\D/g, "");
    const [existe] = await sock.onWhatsApp(`${numero}@s.whatsapp.net`);
    if (!existe?.exists) {
      await q(`UPDATE "WaMensaje" SET estado = 'fallido', error = $2 WHERE id = $1`, [
        m.id,
        "Ese número no tiene WhatsApp",
      ]);
      return;
    }
    // Un poco de "escribiendo…" antes de enviar, como una persona.
    await sock.presenceSubscribe(existe.jid).catch(() => {});
    await sock.sendPresenceUpdate("composing", existe.jid).catch(() => {});
    await sleep(2_000 + Math.random() * 3_000);
    await sock.sendPresenceUpdate("paused", existe.jid).catch(() => {});
    await sock.sendMessage(existe.jid, { text: m.mensaje });
    await q(`UPDATE "WaMensaje" SET estado = 'enviado', "enviadoAt" = now(), error = NULL WHERE id = $1`, [m.id]);
    clog.info({ id: m.id }, "mensaje enviado");
  }

  async function cicloEnvio() {
    for (;;) {
      let esperar = 15_000;
      try {
        const e = await leerEstado();
        const m = minutosBogota();
        const enHorario = m >= HORA_DESDE && m < HORA_HASTA;
        if (conectado && !e.pausado && enHorario && (await enviadosHoy()) < e.maxDia) {
          const msg = await tomarSiguiente();
          if (msg) {
            try {
              await enviarUno(msg);
            } catch (err) {
              const texto = String(err?.message ?? err).slice(0, 300);
              clog.error({ id: msg.id, err: texto }, "falló el envío");
              await q(
                `UPDATE "WaMensaje" SET estado = CASE WHEN intentos >= $2 THEN 'fallido' ELSE 'pendiente' END,
                   error = $3 WHERE id = $1`,
                [msg.id, MAX_INTENTOS, texto],
              );
            }
            // Pausa al azar entre mensajes para no parecer un robot.
            esperar = (PAUSA_MIN + Math.random() * (PAUSA_MAX - PAUSA_MIN)) * 1000;
          }
        }
      } catch (e) {
        clog.error(e, "ciclo de envío");
        esperar = 30_000;
      }
      await sleep(esperar);
    }
  }

  return {
    async iniciar() {
      await guardarEstado({ estado: "iniciando", comando: null });
      await conectar();
      setInterval(latido, 10_000);
      latido();
      cicloEnvio();
    },
    apagar: () => guardarEstado({ estado: "apagado", qr: null }),
  };
}

// ---------- Arranque ----------
const cuentas = CUENTAS.map(crearCuenta);

async function main() {
  await asegurarTablas();
  // Si se cayó a mitad de un envío, ese mensaje vuelve a la cola.
  await q(`UPDATE "WaMensaje" SET estado = 'pendiente' WHERE estado = 'enviando'`);
  for (const c of cuentas) await c.iniciar();
  log.info("Servicio de WhatsApp de Estradox iniciado");
}

const salir = async () => {
  await Promise.all(cuentas.map((c) => c.apagar().catch(() => {})));
  process.exit(0);
};
process.on("SIGINT", salir);
process.on("SIGTERM", salir);

main().catch((e) => {
  log.error(e, "no arrancó");
  process.exit(1);
});
