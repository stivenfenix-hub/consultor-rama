import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CaseActions } from "./case-actions";
import { proximaActualizacionProceso, sinLimiteManual } from "@/lib/limits";
import { CaseTabs, type Datos, type FilaLinea } from "./case-tabs";
import { Icon } from "@/components/icon";
import { avisoProceso } from "@/lib/aviso-rama";
import { extraerGrabaciones, parsePartes } from "@/lib/case-detail";
import { estadosActivo, estadosDelRadicado } from "@/lib/estados";
import { POR_PAGINA, paginaDe } from "@/components/paginador";

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
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  /** tab: pestaña abierta; pa / pd: página de actuaciones / documentos (de a 20). */
  searchParams: Promise<{ tab?: string; pa?: string; pd?: string }>;
}) {
  const { caseId } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const caso = await prisma.case.findFirst({
    where: { id: caseId, userId: user.id },
    include: {
      partes: true,
      syncLogs: { orderBy: { createdAt: "desc" }, take: POR_PAGINA },
    },
  });
  if (!caso) notFound();

  // Estados electrónicos donde salió el radicado.
  const estados = (await estadosActivo(user.id))
    ? await estadosDelRadicado(user.id, caso.radicado)
        .then((e) => ({
          juzgado: e.juzgado,
          revisado: e.revisadoAt ? fmtHora(e.revisadoAt) : null,
          publicaciones: e.publicaciones.map((p) => ({
            id: p.id,
            titulo: p.titulo,
            // Fecha del estado (día sin hora): se muestra tal cual, sin pasar a Bogotá.
            fecha: p.fecha
              ? new Date(p.fecha).toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
              : "—",
            dia: p.fecha ? new Date(p.fecha).toISOString().slice(0, 10) : null,
            extracto: p.extracto,
            archivo: p.archivo,
            url: p.url,
            nuevo: !p.visto,
          })),
        }))
        .catch(() => undefined)
    : undefined;

  // Pestaña Actuaciones: actuaciones y estados del proceso en una sola línea por
  // fecha (más reciente primero). Se ordena con id y fecha, y de la página que
  // se ve (de a 20) se traen los datos completos.
  const ordenActs = await prisma.actuacion.findMany({
    where: { caseId: caso.id },
    orderBy: [{ fechaActuacion: { sort: "desc", nulls: "last" } }, { consActuacion: "desc" }],
    select: { id: true, fechaActuacion: true },
  });
  const diaBogota = (d: Date | null) =>
    d ? new Date(new Date(d).getTime() - 5 * 3600_000).toISOString().slice(0, 10) : null;
  const pubs = estados?.publicaciones ?? [];
  type Entrada = { tipo: "actuacion"; id: string } | { tipo: "estado"; pub: (typeof pubs)[number] };
  const linea: Entrada[] = [];
  for (let i = 0, j = 0; i < ordenActs.length || j < pubs.length; ) {
    const a = ordenActs[i];
    const e = pubs[j];
    const diaA = a ? diaBogota(a.fechaActuacion) : null;
    // El mismo día, el estado va primero.
    if (e && (!a || (e.dia && (!diaA || e.dia >= diaA)))) {
      linea.push({ tipo: "estado", pub: e });
      j++;
    } else {
      linea.push({ tipo: "actuacion", id: a.id });
      i++;
    }
  }
  const pagActs = paginaDe(sp.pa, linea.length);
  const lineaPagina = linea.slice(pagActs.desde, pagActs.desde + POR_PAGINA);
  const actsPagina = await prisma.actuacion.findMany({
    where: { id: { in: lineaPagina.flatMap((f) => (f.tipo === "actuacion" ? [f.id] : [])) } },
  });
  const actPorId = new Map(actsPagina.map((a) => [a.id, a]));
  // Documentos de esas actuaciones (para sus botones "Ver").
  const consPagina = actsPagina.map((a) => a.consActuacion).filter((c): c is number => c != null);
  const docsDeActs = consPagina.length
    ? await prisma.documento.findMany({
        where: { caseId: caso.id, consActuacion: { in: consPagina } },
        select: { idRegDocumento: true, nombre: true, tipo: true, consActuacion: true },
      })
    : [];
  // Grabaciones: solo las actuaciones con un enlace (no hace falta traerlas todas).
  const actsConEnlace = await prisma.actuacion.findMany({
    where: {
      caseId: caso.id,
      OR: [{ anotacion: { contains: "http", mode: "insensitive" } }, { actuacion: { contains: "http", mode: "insensitive" } }],
    },
    orderBy: { fechaActuacion: "desc" },
    select: { actuacion: true, anotacion: true, fechaActuacion: true },
  });
  // Otros registros del mismo radicado (un sistema de la Rama cada uno).
  const registros = await prisma.case.findMany({
    where: { userId: user.id, radicado: caso.radicado },
    orderBy: [{ lastActuacionDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, ubicacion: true, lastActuacionDate: true, unseenCount: true },
  });
  const sistema = (r: { ubicacion: string | null }) =>
    r.ubicacion?.replace(/^Software:\s*/i, "").trim() || "Consulta Nacional Unificada";
  const proximaActualizacion = await proximaActualizacionProceso(
    caso.id,
    await sinLimiteManual(user),
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
  for (const d of docsDeActs) {
    if (d.consActuacion == null) continue;
    const arr = docsByCons.get(d.consActuacion) ?? [];
    arr.push({
      idRegDocumento: d.idRegDocumento,
      nombre: d.nombre ?? "Documento",
      tipo: d.tipo,
    });
    docsByCons.set(d.consActuacion, arr);
  }

  const actuaciones = lineaPagina.flatMap((f): FilaLinea[] => {
    if (f.tipo === "estado") return [{ tipo: "estado", e: f.pub }];
    const a = actPorId.get(f.id);
    if (!a) return [];
    return [
      {
        tipo: "actuacion",
        a: {
          id: a.id,
          fecha: fmtFecha(a.fechaActuacion),
          nombre: a.actuacion ?? "Actuación",
          anotacion: a.anotacion,
          seen: !!a.seenAt,
          conDocumentos: a.conDocumentos,
          docs: a.consActuacion != null ? docsByCons.get(a.consActuacion) ?? [] : [],
        },
      },
    ];
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

  // Documentos de TODAS las fuentes del radicado: p. ej. SIUGJ no publica
  // documentos pero Justicia XXI sí; antes, al abrir el registro SIUGJ,
  // parecía que el proceso no tenía documentos.
  const sistemaDe = new Map(registros.map((r) => [r.id, sistema(r)]));
  // Solo los campos que se muestran; se quitan repetidos entre fuentes y se
  // envían al navegador los 20 de la página.
  const docsTodos = await prisma.documento.findMany({
    where: { caseId: { in: registros.map((r) => r.id) } },
    orderBy: { fechaCarga: "desc" },
    select: { idRegDocumento: true, nombre: true, descripcion: true, tipo: true, fechaCarga: true, caseId: true },
  });
  const docsVistos = new Set<string>();
  const docsUnicos = docsTodos.filter(
    (d) => !docsVistos.has(d.idRegDocumento) && !!docsVistos.add(d.idRegDocumento),
  );
  const pagDocs = paginaDe(sp.pd, docsUnicos.length);
  const documentos = docsUnicos
    .slice(pagDocs.desde, pagDocs.desde + POR_PAGINA)
    .map((d) => ({
      idRegDocumento: d.idRegDocumento,
      nombre: d.nombre ?? "Documento",
      descripcion: d.descripcion,
      tipo: d.tipo,
      fecha: fmtFecha(d.fechaCarga),
      fuente: registros.length > 1 ? sistemaDe.get(d.caseId) : undefined,
    }));

  const grabaciones = extraerGrabaciones(actsConEnlace).map((g) => ({
    ...g,
    fecha: fmtFecha(g.fecha),
  }));

  // Al abogado nunca se le muestran fallas de la Rama (se reintentan solas):
  // ve solo las sincronizaciones exitosas. El root ve todo, con el error.
  const syncLogs = caso.syncLogs.filter((l) => user.role === "admin" || l.resultado === "exito").map((l) => ({
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
        {(() => {
          const a = avisoProceso(caso.lastError, estados !== undefined);
          return a ? ` · ${a.texto}` : "";
        })()}
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
        estados={estados}
        tabInicial={sp.tab}
        paginas={{
          base: `/dashboard/procesos/${caso.id}`,
          actuaciones: { pagina: pagActs.pagina, paginas: pagActs.paginas, total: linea.length },
          documentos: { pagina: pagDocs.pagina, paginas: pagDocs.paginas, total: docsUnicos.length },
        }}
      />
    </div>
  );
}
