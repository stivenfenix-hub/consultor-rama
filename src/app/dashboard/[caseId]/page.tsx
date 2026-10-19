import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CaseActions } from "./case-actions";

function fmtFecha(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
function fmtHora(d: Date | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleString("es-CO");
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
    },
  });
  if (!caso) notFound();

  return (
    <>
      <div className="topbar">
        <Link href="/dashboard" className="brand">
          ← Mis procesos
        </Link>
        <CaseActions
          caseId={caso.id}
          hasUnseen={caso.unseenCount > 0}
        />
      </div>

      <div className="container">
        <h1 className="radicado">{caso.radicado}</h1>
        <p className="muted small">
          Sincronizado: {fmtHora(caso.lastSyncedAt) || "nunca"}
          {caso.lastError ? " · con errores" : ""}
        </p>

        <div className="card">
          <h2>Datos del proceso</h2>
          <dl className="small" style={{ margin: 0 }}>
            <Field label="Despacho" value={caso.despacho} />
            <Field label="Departamento" value={caso.departamento} />
            <Field label="Ponente" value={caso.ponente} />
            <Field label="Tipo de proceso" value={caso.tipoProceso} />
            <Field label="Clase" value={caso.claseProceso} />
            <Field label="Subclase" value={caso.subclaseProceso} />
            <Field label="Recurso" value={caso.recurso} />
            <Field label="Ubicacion" value={caso.ubicacion} />
            <Field label="Sujetos procesales" value={caso.sujetos} />
            <Field label="Fecha del proceso" value={fmtFecha(caso.fechaProceso)} />
          </dl>
          {caso.lastError && (
            <div className="error small">
              Error en la ultima sincronizacion: {caso.lastError}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Actuaciones ({caso.actuaciones.length})</h2>
          {caso.actuaciones.length === 0 && (
            <p className="muted small">Sin actuaciones registradas.</p>
          )}
          {caso.actuaciones.map((a) => (
            <div
              key={a.id}
              className={`event ${a.seenAt ? "" : "unseen"}`}
            >
              <div className="date">
                {fmtFecha(a.fechaActuacion)}
                {!a.seenAt && (
                  <span className="badge new" style={{ marginLeft: 8 }}>
                    nueva
                  </span>
                )}
                {a.conDocumentos && (
                  <span className="badge" style={{ marginLeft: 8 }}>
                    con documentos
                  </span>
                )}
              </div>
              <div className="name">{a.actuacion ?? "Actuacion"}</div>
              {a.anotacion && <div className="note">{a.anotacion}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 8, padding: "4px 0" }}>
      <dt className="muted" style={{ minWidth: 160 }}>
        {label}
      </dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}
