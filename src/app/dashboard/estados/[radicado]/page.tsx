import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EstadoBotones } from "@/components/estado-botones";
import { estadosActivo, estadosDelRadicado, revisionPendiente, vigiladosDelUsuario } from "@/lib/estados";
import { ActualizarEstado } from "./actualizar";
import { QuitarDeEstados } from "../quitar-estado";

const fecha = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "—";
const hora = (d: Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })
    : "aún no";

/** Un radicado que se sigue por los estados del juzgado: solo su información. */
export default async function EstadoRadicadoPage({ params }: { params: Promise<{ radicado: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { radicado } = await params;
  if (!/^\d{23}$/.test(radicado)) notFound();
  if (!(await estadosActivo(user.id))) redirect("/dashboard/procesos");

  // Si también está en la Rama, su ficha completa es la del proceso.
  const caso = await prisma.case.findFirst({ where: { userId: user.id, radicado }, select: { id: true } });
  if (caso) redirect(`/dashboard/procesos/${caso.id}`);
  const vigilado = (await vigiladosDelUsuario(user.id)).find((v) => v.radicado === radicado);
  if (!vigilado) notFound();

  const [{ publicaciones, juzgado, revisadoAt }, pendiente] = await Promise.all([
    estadosDelRadicado(user.id, radicado),
    revisionPendiente(radicado).catch(() => null),
  ]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link prefetch={false} href="/dashboard/procesos" className="small muted">← Procesos</Link>
          <h1 className="radicado" style={{ marginTop: 4 }}>{radicado}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {juzgado ?? `Juzgado ${vigilado.despacho}`} · {radicado.slice(12, 16)}-{radicado.slice(16, 21)} ·{" "}
            <span className="badge">solo en estados</span>
          </p>
        </div>
        <ActualizarEstado
          radicado={radicado}
          revisadoAt={revisadoAt ? new Date(revisadoAt).toISOString() : null}
          pendienteDesde={pendiente ? new Date(pendiente).toISOString() : null}
        />
      </div>

      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          No está en la Consulta Nacional de la Rama, así que lo seguimos en los Estados electrónicos (Publicaciones
          Procesales) del juzgado: cada noche, con la tecnología de IA de Estradox, revisamos su último estado. Última
          revisión: {hora(revisadoAt)}.
        </p>
        <h2>Dónde salió ({publicaciones.length})</h2>
        {publicaciones.length === 0 ? (
          <p className="muted small">
            Todavía no sale en los estados del juzgado. Te avisamos apenas aparezca.
          </p>
        ) : (
          publicaciones.map((h) => (
            <div key={h.id} className="case" style={{ cursor: "default" }}>
              <div className="row wrap">
                <b>{h.titulo}</b>
                <div className="spacer" />
                <span className="muted small">{fecha(h.fecha)}</span>
              </div>
              {h.extracto && (
                <div className="muted small" style={{ marginTop: 4 }}>
                  …{h.extracto}…
                </div>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                <EstadoBotones hallazgoId={h.id} documentos={h.documentos} />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Dejar de seguirlo</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Si ya no quieres seguir este radicado, quítalo. Si lo vuelves a agregar en Procesos, se vigila otra vez.
        </p>
        <QuitarDeEstados radicado={radicado} enRama={false} volverA="/dashboard/procesos" />
      </div>
    </div>
  );
}
