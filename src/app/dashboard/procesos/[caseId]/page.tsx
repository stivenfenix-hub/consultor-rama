import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CaseActions } from "./case-actions";
import { CaseTabs, type Datos } from "./case-tabs";

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

/** Convierte el string de sujetos de la Rama en una lista {rol, nombre}. */
function parsePartes(
  sujetos: string | null,
): { rol: string; nombre: string }[] {
  if (!sujetos) return [];
  return sujetos
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const idx = seg.indexOf(":");
      if (idx < 0) return { rol: "Parte", nombre: seg };
      return {
        rol: seg.slice(0, idx).trim(),
        nombre: seg.slice(idx + 1).trim(),
      };
    });
}

// Detecta enlaces a grabaciones dentro del texto de las actuaciones.
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const MEDIA_HOST =
  /(youtube\.com|youtu\.be|drive\.google|meet\.google|docs\.google|teams\.microsoft|zoom\.us|vimeo\.com|onedrive|1drv\.ms|dropbox\.com)/i;
const MEDIA_EXT = /\.(mp4|mp3|wav|m4a|mov|avi|mkv|ogg|webm)(\?|$)/i;

function extraerGrabaciones(
  acts: { anotacion: string | null; actuacion: string | null; fechaActuacion: Date | null }[],
): { fecha: string; actuacion: string; url: string }[] {
  const out: { fecha: string; actuacion: string; url: string }[] = [];
  const vistas = new Set<string>();
  for (const a of acts) {
    const texto = `${a.anotacion ?? ""} ${a.actuacion ?? ""}`;
    const urls = texto.match(URL_RE) ?? [];
    for (const raw of urls) {
      const url = raw.replace(/[.,;)]+$/, "");
      if ((MEDIA_HOST.test(url) || MEDIA_EXT.test(url)) && !vistas.has(url)) {
        vistas.add(url);
        out.push({
          fecha: fmtFecha(a.fechaActuacion),
          actuacion: a.actuacion ?? "Actuación",
          url,
        });
      }
    }
  }
  return out;
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

  const actuaciones = caso.actuaciones.map((a) => ({
    id: a.id,
    fecha: fmtFecha(a.fechaActuacion),
    nombre: a.actuacion ?? "Actuación",
    anotacion: a.anotacion,
    seen: !!a.seenAt,
    conDocumentos: a.conDocumentos,
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

  const documentos = caso.documentos.map((d) => ({
    idRegDocumento: d.idRegDocumento,
    nombre: d.nombre ?? "Documento",
    descripcion: d.descripcion,
    tipo: d.tipo,
    fecha: fmtFecha(d.fechaCarga),
  }));

  const grabaciones = extraerGrabaciones(caso.actuaciones);

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
            ← Procesos
          </Link>
          <h1 className="radicado" style={{ marginTop: 4 }}>
            {caso.radicado}
          </h1>
        </div>
        <CaseActions caseId={caso.id} hasUnseen={caso.unseenCount > 0} />
      </div>

      <p className="muted small">
        Sincronizado: {fmtHora(caso.lastSyncedAt)}
        {caso.lastError ? " · con errores" : ""}
      </p>

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
