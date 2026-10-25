/**
 * Worker local (alternativa al cron de Hostinger): corre la cola de
 * sincronización cada 5 minutos. El horario lo decide lib/sync-queue.ts.
 *
 *   npm run cron
 */
import cron from "node-cron";
import { tick } from "../src/lib/sync-queue";

async function run() {
  try {
    console.log("[cron]", JSON.stringify(await tick()));
  } catch (err) {
    console.error("[cron] error:", err);
  }
}

run();
cron.schedule("*/5 * * * *", run);
console.log("[cron] worker activo (cada 5 minutos).");
