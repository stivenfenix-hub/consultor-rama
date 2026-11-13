import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { casoConMensajes, marcarVisto } from "@/lib/soporte";
import { estadoCasoAction } from "../actions";
import { Responder } from "../formularios";
import { Conversacion, EtiquetaEstado, TipoCaso } from "../piezas";

export const dynamic = "force-dynamic";

export default async function CasoSoportePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ enviado?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { enviado } = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const r = await casoConMensajes(Number(id), user.id);
  if (!r) notFound();
  const { caso, mensajes } = r;
  if (!caso.vistoUsuario) await marcarVisto(caso.id, "usuario");

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Link prefetch={false} href="/dashboard/soporte" className="small">
            ← Soporte y PQRS
          </Link>
          <h1 style={{ overflowWrap: "anywhere" }}>{caso.asunto}</h1>
          <div className="row wrap" style={{ gap: 10 }}>
            <TipoCaso tipo={caso.tipo} />
            <EtiquetaEstado estado={caso.estado} lado="usuario" />
          </div>
        </div>
      </div>

      {enviado && (
        <div className="ok" style={{ marginBottom: 12 }}>
          ¡Recibimos tu mensaje! Te avisaremos por notificación y correo cuando te respondamos.
        </div>
      )}

      <div className="card" style={{ maxWidth: 760 }}>
        <Conversacion mensajes={mensajes} lado="usuario" nombreUsuario="Tú" />
        {caso.estado === "cerrado" ? (
          <form action={estadoCasoAction} className="row wrap" style={{ gap: 8, alignItems: "center", marginTop: 12 }}>
            <input type="hidden" name="id" value={caso.id} />
            <input type="hidden" name="estado" value="abierto" />
            <span className="muted small">Este caso está resuelto.</span>
            <button className="btn secondary small" type="submit">
              Volver a abrir
            </button>
          </form>
        ) : (
          <>
            <Responder id={caso.id} lado="usuario" placeholder="Escribe aquí para agregar algo o responder…" />
            {caso.estado === "respondido" && (
              <form action={estadoCasoAction} style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={caso.id} />
                <input type="hidden" name="estado" value="cerrado" />
                <button className="btn secondary small" type="submit">
                  ✓ Ya quedó resuelto
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
