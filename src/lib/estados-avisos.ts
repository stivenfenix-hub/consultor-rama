import "server-only";
import { prisma } from "./db";
import { bloqueoPortal } from "./estados";

/**
 * Avisa al root (campanita y push) cuando el portal de Publicaciones
 * Procesales bloquea una salida (VPS u Hostinger) y cuando vuelve a responder.
 * Lo llama el cron de cada 5 minutos (Hostinger). Va aparte de estados.ts
 * porque el servicio del VPS no lleva el código de notificaciones.
 */
export async function avisarBloqueosEstados() {
  await bloqueoPortal(); // asegura las tablas
  const filas = await prisma.$queryRawUnsafe<
    { salida: string; hasta: Date; status: number | null; levantado: Date | null; avisadoAt: Date | null }[]
  >(`SELECT salida, hasta, status, levantado, "avisadoAt" FROM "EstadoBloqueo"`);
  if (!filas.length) return 0;
  const admins = (await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } })).map((u) => u.id);
  if (!admins.length) return 0;
  const { sendPushToUsers } = await import("./push");
  const hora = (d: Date) =>
    new Date(d).toLocaleString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });
  const nombre = (s: string) => (s === "vps" ? "el VPS" : "Hostinger");
  let n = 0;
  for (const f of filas) {
    if (!f.levantado && !f.avisadoAt) {
      await sendPushToUsers(admins, {
        title: "⚠️ Estados electrónicos en pausa",
        body: `El portal de Publicaciones Procesales bloqueó ${nombre(f.salida)} (${f.status ?? "403"}). Pausamos las consultas hasta las ${hora(f.hasta)} y luego probamos una consulta cada 3 horas.`,
        url: "/dashboard/admin",
        tag: `estados-bloqueo-${f.salida}`,
      }).catch((e) => console.error("[estados] aviso bloqueo", e));
      await prisma.$executeRawUnsafe(`UPDATE "EstadoBloqueo" SET "avisadoAt" = now() WHERE salida = $1`, f.salida);
      n++;
    } else if (f.levantado) {
      if (f.avisadoAt) {
        await sendPushToUsers(admins, {
          title: "✅ Estados electrónicos de nuevo en marcha",
          body: `El portal de Publicaciones Procesales volvió a responder a ${nombre(f.salida)}.`,
          url: "/dashboard/admin",
          tag: `estados-bloqueo-${f.salida}`,
        }).catch((e) => console.error("[estados] aviso levantado", e));
        n++;
      }
      await prisma.$executeRawUnsafe(`DELETE FROM "EstadoBloqueo" WHERE salida = $1 AND levantado IS NOT NULL`, f.salida);
    }
  }
  return n;
}
