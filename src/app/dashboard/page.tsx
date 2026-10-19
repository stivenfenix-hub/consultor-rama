import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logoutAction } from "@/app/actions";
import { AddCaseForm } from "./add-case-form";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const cases = await prisma.case.findMany({
    where: { userId: user.id },
    orderBy: [{ lastActuacionDate: "desc" }, { createdAt: "desc" }],
  });

  return (
    <>
      <div className="topbar">
        <span className="brand">⚖️ Consultor de Procesos</span>
        <div className="row">
          <span className="muted small">{user.name ?? user.email}</span>
          <form action={logoutAction}>
            <button className="btn secondary small" type="submit">
              Salir
            </button>
          </form>
        </div>
      </div>

      <div className="container">
        <div className="card">
          <h2>Agregar proceso por radicado</h2>
          <AddCaseForm />
        </div>

        <h1>Mis procesos ({cases.length})</h1>
        {cases.length === 0 && (
          <p className="muted">
            Aun no sigues ningun proceso. Agrega uno con su radicado de 23
            digitos.
          </p>
        )}

        {cases.map((c) => (
          <Link key={c.id} href={`/dashboard/${c.id}`} className="case">
            <div className="row wrap">
              <span className="radicado">{c.radicado}</span>
              {c.unseenCount > 0 && (
                <span className="badge new">{c.unseenCount} nuevas</span>
              )}
              {c.esPrivado && <span className="badge">privado</span>}
              <div className="spacer" />
              <span className="muted small">
                Ult. actuacion: {fmt(c.lastActuacionDate)}
              </span>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              {c.despacho ?? "Despacho no disponible"}
              {c.departamento ? ` · ${c.departamento}` : ""}
            </div>
            {c.lastError && (
              <div className="error small">Error ultima sync: {c.lastError}</div>
            )}
          </Link>
        ))}
      </div>
    </>
  );
}
