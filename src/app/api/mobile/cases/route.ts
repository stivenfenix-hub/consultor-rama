import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agregarRadicados, mensajeAgregar } from "@/lib/sync";
import { analizarRadicados, MAX_RADICADOS_POR_ENVIO } from "@/lib/validation";
import { body, jsonError, str, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";
// Agregar varios radicados consulta la Rama, que puede ser lenta.
export const maxDuration = 300;

// GET -> { cases: [...] }
export async function GET(req: NextRequest) {
  return withMobileUser(req, async (user) => {
    const cases = await prisma.case.findMany({
      where: { userId: user.id },
      orderBy: [{ lastActuacionDate: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({
      cases: cases.map((c) => ({
        id: c.id,
        radicado: c.radicado,
        despacho: c.despacho,
        departamento: c.departamento,
        claseProceso: c.claseProceso,
        esPrivado: c.esPrivado,
        unseenCount: c.unseenCount,
        lastActuacionDate: c.lastActuacionDate,
        lastSyncedAt: c.lastSyncedAt,
        lastError: c.lastError,
      })),
    });
  });
}

// POST { radicados: "uno o varios, separados por coma o espacio" } -> { ok, agregados, fallidos }
export async function POST(req: NextRequest) {
  return withMobileUser(req, async (user) => {
    const { validos, invalidos } = analizarRadicados(str((await body(req)).radicados));
    if (validos.length === 0) {
      return jsonError(
        invalidos.length
          ? `El radicado debe tener 23 dígitos. Revisa: ${invalidos.join(", ")}.`
          : "Ingresa uno o más radicados de 23 dígitos (separados por coma o espacio).",
        400,
      );
    }
    if (validos.length > MAX_RADICADOS_POR_ENVIO) {
      return jsonError(
        `Puedes agregar máximo ${MAX_RADICADOS_POR_ENVIO} procesos por vez y pegaste ${validos.length}. Agrégalos en tandas de ${MAX_RADICADOS_POR_ENVIO}.`,
        400,
      );
    }
    const r = await agregarRadicados(user.id, validos);
    const m = mensajeAgregar(r, invalidos);
    const agregados = r.agregados + r.pendientes + r.privados + r.yaEstaban + r.enFondo;
    const fallidos = validos.length - agregados;
    if (!m.ok) return jsonError(m.error ?? "No se pudo agregar ningún proceso.", 502);
    return NextResponse.json({
      // La app muestra solo "ok": se le suma el aviso de los que fallaron.
      ok: m.error ? `${m.ok} ${m.error}` : m.ok,
      agregados,
      fallidos,
    });
  });
}
