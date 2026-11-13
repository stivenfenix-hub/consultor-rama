import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { casosDelUsuario } from "@/lib/soporte";
import { NuevoCaso } from "./formularios";
import { FilaCaso } from "./piezas";

export const dynamic = "force-dynamic";

export default async function SoportePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const casos = await casosDelUsuario(user.id);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Soporte y PQRS</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Escríbenos tus preguntas, problemas, sugerencias, peticiones, quejas o reclamos. Te respondemos aquí y te
            avisamos por notificación y correo.
          </p>
        </div>
      </div>

      <div className="soporte-grid">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Escríbenos</h2>
          <NuevoCaso />
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Mis mensajes ({casos.length})</h2>
          {casos.length === 0 ? (
            <p className="muted small">
              Aún no nos has escrito. Cuando lo hagas, aquí verás cada conversación y su estado: esperando
              respuesta, respondido o resuelto.
            </p>
          ) : (
            casos.map((c) => <FilaCaso key={c.id} c={c} href={`/dashboard/soporte/${c.id}`} lado="usuario" />)
          )}
        </div>
      </div>
    </div>
  );
}
