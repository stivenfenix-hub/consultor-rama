import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { proximaActualizacionProceso, sinLimiteManual } from "@/lib/limits";
import { extraerGrabaciones, parsePartes } from "@/lib/case-detail";
import { jsonError, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET -> detalle completo del proceso (las mismas pestañas que la web).
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withMobileUser(req, async (user) => {
    const caso = await prisma.case.findFirst({
      where: { id, userId: user.id },
      include: {
        actuaciones: { orderBy: { fechaActuacion: "desc" } },
        documentos: { orderBy: { fechaCarga: "desc" } },
        partes: true,
        syncLogs: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!caso) return jsonError("Proceso no encontrado.", 404);
    const proximaActualizacion = await proximaActualizacionProceso(caso.id, await sinLimiteManual(user));

    const datos = [
      { label: "Despacho", value: caso.despacho },
      { label: "Departamento", value: caso.departamento },
      { label: "Ponente", value: caso.ponente },
      { label: "Tipo de proceso", value: caso.tipoProceso },
      { label: "Clase", value: caso.claseProceso },
      { label: "Subclase", value: caso.subclaseProceso },
      { label: "Recurso", value: caso.recurso },
      { label: "Ubicación", value: caso.ubicacion },
    ].filter((d): d is { label: string; value: string } => !!d.value);

    const doc = (d: (typeof caso.documentos)[number]) => ({
      id: d.idRegDocumento,
      nombre: d.nombre ?? "Documento",
      descripcion: d.descripcion,
      tipo: d.tipo,
      fechaCarga: d.fechaCarga,
    });

    // Partes estructuradas; si aún no hay (proceso sincronizado antes), parsea el texto.
    const partes =
      caso.partes.length > 0
        ? caso.partes.map((p) => ({
            rol: p.tipoSujeto ?? "Parte",
            nombre: p.nombre ?? "—",
            identificacion: p.identificacion,
          }))
        : parsePartes(caso.sujetos).map((p) => ({ ...p, identificacion: null }));

    return NextResponse.json({
      id: caso.id,
      radicado: caso.radicado,
      esPrivado: caso.esPrivado,
      fechaProceso: caso.fechaProceso,
      lastSyncedAt: caso.lastSyncedAt,
      lastError: caso.lastError,
      unseenCount: caso.unseenCount,
      /** Cuándo se puede volver a actualizar manualmente (ISO) o null si ya se puede. */
      proximaActualizacion,
      datos,
      actuaciones: caso.actuaciones.map((a) => ({
        id: a.id,
        fecha: a.fechaActuacion,
        nombre: a.actuacion ?? "Actuación",
        anotacion: a.anotacion,
        seen: !!a.seenAt,
        conDocumentos: a.conDocumentos,
        docs:
          a.consActuacion != null
            ? caso.documentos.filter((d) => d.consActuacion === a.consActuacion).map(doc)
            : [],
      })),
      documentos: caso.documentos.map(doc),
      partes,
      grabaciones: extraerGrabaciones(caso.actuaciones),
      syncLogs: caso.syncLogs.map((l) => ({
        inicio: l.createdAt,
        origen: l.origen,
        operacion: l.operacion,
        resultado: l.resultado,
        duracionMs: l.durationMs,
        elementos: l.elementos,
        error: l.error,
      })),
    });
  });
}

// DELETE -> { ok }. Deja de seguir el proceso.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withMobileUser(
    req,
    async (user) => {
      // Todos los registros del radicado (uno por sistema de la Rama).
      const caso = await prisma.case.findFirst({
        where: { id, userId: user.id },
        select: { radicado: true },
      });
      if (caso) await prisma.case.deleteMany({ where: { userId: user.id, radicado: caso.radicado } });
      return NextResponse.json({ ok: "Proceso eliminado." });
    },
    { allowExpired: true },
  );
}
