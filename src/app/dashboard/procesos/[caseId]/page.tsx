import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CaseActions } from "./case-actions";
import { proximaActualizacionProceso } from "@/lib/limits";
import { CaseTabs, type Datos } from "./case-tabs";
import { Icon } from "@/components/icon";
import { extraerGrabaciones, parsePartes } from "@/lib/case-detail";

const TZ = "America/Bogota";
function fmtFecha(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TZ,
  });
}
function fmtHora(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-CO", { timeZone: TZ });
}

export default async function CaseDetail({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const caso = await prisma.case.findFirst({
    where: { id: caseId, userId: user.id },
    include: {
      actuaciones: { orderBy: { fechaActuacion: "desc" } },
      documentos: { orderBy: { fechaCarga: "desc" } },
      partes: true,
      syncLogs: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!caso) notFound();
  // Otros registros del mismo radicado (un sistema de la Rama cada uno).
  const registros = await prisma.case.findMany({
    where: { userId: user.id, radicado: caso.radicado },
    orderBy: [{ lastActuacionDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, ubicacion: true, lastActuacionDate: true, unseenCount: true },
  });
  const sistema = (r: { ubicacion: string | null }) =>
    r.ubicacion?.replace(/^Software:\s*/i, "").trim() || "Consulta Nacional Unificada";
  const proximaActualizacion = await proximaActualizacionProceso(
    caso.id,
    user.role === "admin",
  );

  const datos: Datos = [
    { label: "Despacho", value: caso.despacho },
    { label: "Departamento", value: caso.departamento },
    { label: "Ponente", value: caso.ponente },
    { label: "Tipo de proceso", value: caso.tipoProceso },
    { label: "Clase", value: caso.claseProceso },
    { label: "Subclase", value: caso.subclaseProceso },
    { label: "Recurso", value: caso.recurso },
    { label: "Ubicación", value: caso.ubicacion },
    { label: "Fecha del proceso", value: fmtFecha(caso.fechaProceso) },
  ].filter((d): d is { label: string; value: string } => !!d.value);

  // Documentos agrupados por su actuación (campo consActuacion).
  const docsByCons = new Map<
    number,
    { idRegDocumento: string; nombre: string; tipo: string | null }[]
  >();
  for (const d of caso.documentos) {
    if (d.consActuacion == null) continue;
    const arr = docsByCons.get(d.consActuacion) ?? [];
    arr.push({
      idRegDocumento: d.idRegDocumento,
      nombre: d.nombre ?? "Documento",
      tipo: d.tipo,
    });
    docsByCons.set(d.consActuacion, arr);
  }

  const actuaciones = caso.actuaciones.map((a) => ({
    id: a.id,
    fecha: fmtFecha(a.fechaActuacion),
    nombre: a.actuacion ?? "Actuación",
    anotacion: a.anotacion,
    seen: !!a.seenAt,
    conDocumentos: a.conDocumentos,
    docs: a.consActuacion != null ? docsByCons.get(a.consActuacion) ?? [] : [],
  }));

  // Partes estructuradas; si aún no hay (proceso sincronizado antes), parsea el texto.
  const partes =
    caso.partes.length > 0
      ? caso.partes.map((p) => ({
          rol: p.tipoSujeto ?? "Parte",
          nombre: p.nombre ?? "—",
          identificacion: p.identificacion,
        }))
      : parsePartes(caso.sujetos).map((p) => ({ ...p, identificacion: null }));

  // Documentos de TODAS las fuentes del radicado: p. ej. SIUGJ no publica
  // documentos pero Justicia XXI sí; antes, al abrir el registro SIUGJ,
  // parecía que el proceso no tenía documentos.
  const sistemaDe = new Map(registros.map((r) => [r.id, sistema(r)]));
  const docsTodos =
    registros.length > 1
      ? await prisma.documento.findMany({
          where: { caseId: { in: registros.map((r) => r.id) } },
          orderBy: { fechaCarga: "desc" },
        })
      : caso.documentos;
  const docsVistos = new Set<string>();
  const documentos = docsTodos
    .filter((d) => !docsVistos.has(d.idRegDocumento) && !!docsVistos.add(d.idRegDocumento))
    .map((d) => ({
      idRegDocumento: d.idRegDocumento,
      nombre: d.nombre ?? "Documento",
      descripcion: d.descripcion,
      tipo: d.tipo,
      fecha: fmtFecha(d.fechaCarga),
      fuente: registros.length > 1 ? sistemaDe.get(d.caseId) : undefined,
    }));

  const grabaciones = extraerGrabaciones(caso.actuaciones).map((g) => ({
    ...g,
    fecha: fmtFecha(g.fecha),
  }));

  const syncLogs = caso.syncLogs.map((l) => ({
    inicio: fmtHora(l.createdAt),
    origen: l.origen,
    operacion: l.operacion,
    resultado: l.resultado,
    duracion: l.durationMs,
    elementos: l.elementos,
    error: l.error,
  }));

  return (
    <div className="page">
      <div className="page-head wrap">
        <div>
          <Link href="/dashboard/procesos" className="small muted">
            <Icon name="arrowLeft" size={14} /> Procesos
          </Link>
          <h1 className="radicado" style={{ marginTop: 4 }}>
            {caso.radicado}
          </h1>
        </div>
        <CaseActions
          caseId={caso.id}
          hasUnseen={caso.unseenCount > 0}
          actualizadoHoy={!!proximaActualizacion}
        />
      </div>

      <p className="muted small">
        Sincronizado: {fmtHora(caso.lastSyncedAt)}
        {caso.lastError
          ? caso.lastError.startsWith("Proceso privado")
            ? ` · 🔒 ${caso.lastError}`
            : " · con errores"
          : ""}
      </p>

      <section className="fuente">
        <div className="fuente-head">
          <Icon name="sello" size={18} />
          <span>
            Fuente de la información: <b>Rama Judicial</b> · <b>{sistema(caso)}</b>
          </span>
        </div>
        {registros.length > 1 && (
          <>
            <p className="muted small" style={{ margin: "6px 0 8px" }}>
              Este radicado aparece en {registros.length} sistemas de la Rama. Toca uno para ver su información.
            </p>
            <div className="fuente-tabs">
              {registros.map((r, i) => (
                <Link
                  key={r.id}
                  href={`/dashboard/procesos/${r.id}`}
                  className={`fuente-tab ${r.id === caso.id ? "sel" : ""}`}
                  scroll={false}
                >
                  <b>{sistema(r)}</b>
                  <span className="small muted">Últ. actuación: {fmtFecha(r.lastActuacionDate)}</span>
                  <span className="row" style={{ gap: 4 }}>
                    {i === 0 && <span className="badge reciente">más reciente</span>}
                    {r.unseenCount > 0 && <span className="badge new">{r.unseenCount} nuevas</span>}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>

      <CaseTabs
        datos={datos}
        actuaciones={actuaciones}
        partes={partes}
        documentos={documentos}
        grabaciones={grabaciones}
        syncLogs={syncLogs}
      />
    </div>
  );
}
