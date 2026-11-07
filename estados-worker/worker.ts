/**
 * Servicio de estados electrónicos de Estradox (corre en el VPS, no en Hostinger).
 *
 * Usa el mismo código de la app (src/lib/estados.ts): de noche revisa cada
 * juzgado una vez y lee su último estado; de día solo atiende los juzgados
 * pedidos (radicados recién agregados o "Revisar ahora" del root). Los
 * hallazgos quedan en la base y salen en el resumen de las 7 a. m. (correo,
 * WhatsApp y notificación), que sigue enviando la app.
 *
 * Variables (.env): DATABASE_URL, ESTRADOX_DB_POOL, ESTADOS_DESPACHOS_POR_CORRIDA,
 * ESTADOS_PAUSA_MS. Ver README.md.
 */
import { revisarEstados } from "../src/lib/estados";

const ESPERA_SIN_TRABAJO_MS = 60_000; // nada pendiente: vuelve a mirar en 1 minuto
const ESPERA_CON_TRABAJO_MS = 5_000; // hubo juzgados: sigue casi enseguida

let parar = false;
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => (parar = true));

const log = (msg: string, extra?: unknown) =>
  console.log(
    `[${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}] ${msg}`,
    extra === undefined ? "" : JSON.stringify(extra),
  );

log("Servicio de estados electrónicos iniciado");
while (!parar) {
  let hubo = false;
  try {
    const info = await revisarEstados();
    if ("omitido" in info) {
      if (info.omitido !== "fuera del horario nocturno") log(`omitido: ${info.omitido}`);
    } else {
      hubo = (info.revisados?.length ?? 0) > 0;
      if (hubo) log(`revisados ${info.revisados!.length} de ${info.despachos} juzgados`, info.revisados);
    }
  } catch (e) {
    log("error", e instanceof Error ? e.message : String(e));
  }
  await new Promise((r) => setTimeout(r, hubo ? ESPERA_CON_TRABAJO_MS : ESPERA_SIN_TRABAJO_MS));
}
log("Servicio detenido");
process.exit(0);
