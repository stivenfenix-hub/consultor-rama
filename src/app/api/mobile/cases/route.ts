import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { iniciarCargaProcesos } from "@/lib/sync";
import { analizarRadicados, MAX_RADICADOS_POR_ENVIO } from "@/lib/validation";
import { body, jsonError, str, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";
// Agregar varios radicados consulta la Rama, que puede ser lenta.
export const maxDuration = 300;

// GET [?pagina=N] -> { cases: [...], total, pagina, paginas }
// Con ?pagina= devuelve de a 20; sin ella, todos (la app instalada aún no pagina).
export async function GET(req: NextRequest) {
  return withMobileUser(req, async (user) => {
    const pedida = req.nextUrl.searchParams.get("pagina");
    const POR_PAGINA = 20;
    const total = await prisma.case.count({ where: { userId: user.id } });
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const pagina = pedida ? Math.min(paginas, Math.max(1, Number(pedida) || 1)) : 1;
    const cases = await prisma.case.findMany({
      where: { userId: user.id },
      orderBy: [{ lastActuacionDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      ...(pedida ? { skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA } : {}),
      // Solo lo que muestra la lista (sin partes, sujetos ni detalle).
      select: {
        id: true,
        radicado: true,
        despacho: true,
        departamento: true,
        claseProceso: true,
        esPrivado: true,
        unseenCount: true,
        lastActuacionDate: true,
        lastSyncedAt: true,
        lastError: true,
      },
    });
    return NextResponse.json({
      total,
      pagina,
      paginas: pedida ? paginas : 1,
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
    // Se carga en segundo plano (la Rama puede tardar o estar caída): al
    // terminar llega la notificación, y lo que falle se reintenta solo.
    await iniciarCargaProcesos(user.id, validos, invalidos);
    return NextResponse.json({
      ok: "Estamos cargando tus procesos. Te avisamos cuando estén listos.",
      agregados: validos.length,
      fallidos: 0,
    });
  });
}
