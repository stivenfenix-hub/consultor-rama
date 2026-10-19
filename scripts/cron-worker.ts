/**
 * Worker local para refrescar los procesos cada 24h sin depender de Vercel.
 * Utilo si despliegas en un servidor propio o quieres probarlo en local.
 *
 *   npm run cron
 *
 * Corre una vez al arrancar y luego todos los dias a las 07:00.
 */
import cron from "node-cron";
import { sincronizarTodos } from "../src/lib/sync";

async function run() {
  const inicio = new Date();
  console.log(`[cron] ${inicio.toISOString()} - refrescando procesos...`);
  try {
    const r = await sincronizarTodos();
    const nuevas = r.reduce((n, x) => n + (x.nuevas ?? 0), 0);
    const fallidos = r.filter((x) => !x.ok).length;
    console.log(
      `[cron] hecho: ${r.length} procesos, ${nuevas} actuaciones nuevas, ${fallidos} fallidos.`,
    );
  } catch (err) {
    console.error("[cron] error:", err);
  }
}

// Al arrancar
run();

// Todos los dias a las 07:00 (hora del servidor)
cron.schedule("0 7 * * *", run);

console.log("[cron] worker activo. Esperando la proxima corrida (07:00 diaria).");
