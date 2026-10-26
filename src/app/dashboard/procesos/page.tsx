import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AddCaseForm } from "./add-case-form";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Bogota",
  });
}

export default async function ProcesosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const cases = await prisma.case.findMany({
    where: { userId: user.id },
    orderBy: [{ lastActuacionDate: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Procesos</h1>
      </div>

      <div className="card">
        <h2>Agregar proceso por radicado</h2>
        <AddCaseForm />
      </div>

      <p className="muted small">{cases.length} proceso(s)</p>

      {cases.length === 0 && (
        <p className="muted">
          Aún no sigues ningún proceso. Agrega uno con su radicado de 23 dígitos.
        </p>
      )}

      {cases.map((c) => (
        <Link
          key={c.id}
          href={`/dashboard/procesos/${c.id}`}
          className="case"
        >
          <div className="row wrap">
            <span className="radicado">{c.radicado}</span>
            {c.unseenCount > 0 && (
              <span className="badge new">{c.unseenCount} nuevas</span>
            )}
            {c.esPrivado && <span className="badge">privado</span>}
            <div className="spacer" />
            <span className="muted small">
              Últ. actuación: {fmt(c.lastActuacionDate)}
            </span>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {c.despacho ?? "Despacho no disponible"}
            {c.departamento ? ` · ${c.departamento}` : ""}
          </div>
          {c.lastError &&
            (c.lastError.startsWith("Proceso privado") ? (
              <div className="muted small" style={{ marginTop: 4 }}>🔒 {c.lastError}</div>
            ) : (
              <div className="error small">Error última sync: {c.lastError}</div>
            ))}
        </Link>
      ))}
    </div>
  );
}
