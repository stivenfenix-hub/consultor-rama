import "server-only";
import { revalidatePath } from "next/cache";
import { marcarActualizacionProceso } from "./limits";
import { esProcesoPrivado, revisarProcesoManual } from "./sync-queue";

/**
 * El abogado actualizó un proceso a mano y la Rama no respondió. No se le
 * muestra el error: se reintenta solo (a los 2, 5 y 10 minutos) y se le
 * notifica cuando queda listo. Si nunca responde, lo revisa la noche.
 * Se llama dentro de after() (web y app Android).
 */
export async function reintentarActualizacion(caseId: string, userId: string, radicado: string) {
  const { sendPushToUser } = await import("./push");
  for (const min of [2, 5, 10]) {
    await new Promise((r) => setTimeout(r, min * 60_000));
    try {
      const { nuevas } = await revisarProcesoManual(caseId);
      await marcarActualizacionProceso(caseId);
      try {
        revalidatePath(`/dashboard/procesos/${caseId}`);
      } catch {
        // fuera de una petición no hay caché que limpiar
      }
      await sendPushToUser(userId, {
        title: "✅ Tu proceso está actualizado",
        body: nuevas
          ? `${radicado}: ${nuevas} actuación(es) nueva(s). Ya puedes revisarlas.`
          : `${radicado} ya está al día. No hay actuaciones nuevas.`,
        url: `/dashboard/procesos/${caseId}`,
        tag: `actualizar-${caseId}`,
      }).catch(() => {});
      return;
    } catch (e) {
      if (esProcesoPrivado(e)) return;
    }
  }
}
