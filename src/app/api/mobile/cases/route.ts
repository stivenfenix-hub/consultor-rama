import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agregarProcesoPorRadicado } from "@/lib/sync";
import { parseRadicados } from "@/lib/validation";
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
    const radicados = parseRadicados(str((await body(req)).radicados));
    if (radicados.length === 0) {
      return jsonError(
        "Ingresa uno o más radicados de 23 dígitos (separados por coma o espacio).",
        400,
      );
    }
    let agregados = 0;
    let fallidos = 0;
    for (const rad of radicados) {
      try {
        await agregarProcesoPorRadicado(user.id, rad);
        agregados++;
      } catch {
        fallidos++;
      }
    }
    if (agregados === 0) {
      return jsonError(
        "No se pudo agregar ningún proceso (la Rama puede estar lenta o los radicados no existen).",
        502,
      );
    }
    return NextResponse.json({
      ok: `${agregados} proceso(s) agregado(s)${fallidos ? `, ${fallidos} con error` : ""}.`,
      agregados,
      fallidos,
    });
  });
}
