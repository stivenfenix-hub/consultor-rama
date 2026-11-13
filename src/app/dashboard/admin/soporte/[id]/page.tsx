import Link from "next/link";
import { notFound } from "next/navigation";
import { casoConMensajes, marcarVisto } from "@/lib/soporte";
import { estadoCasoAction } from "../../../soporte/actions";
import { Responder } from "../../../soporte/formularios";
import { Conversacion, EtiquetaEstado, fechaHora, TipoCaso } from "../../../soporte/piezas";

export const dynamic = "force-dynamic";

export default async function AdminCasoSoportePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const r = await casoConMensajes(Number(id));
  if (!r) notFound();
  const { caso, mensajes } = r;
  if (!caso.vistoSoporte) await marcarVisto(caso.id, "soporte");
  const nombre = caso.nombre ?? caso.email ?? "Usuario";

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Link prefetch={false} href="/dashboard/admin/soporte" className="small">
            ← Soporte y PQRS
          </Link>
          <h1 style={{ overflowWrap: "anywhere" }}>{caso.asunto}</h1>
          <div className="row wrap" style={{ gap: 10 }}>
            <TipoCaso tipo={caso.tipo} />
            <EtiquetaEstado estado={caso.estado} lado="soporte" />
            <span className="muted small">Abierto el {fechaHora(caso.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          <b>{nombre}</b>
          <span className="muted small">{caso.email}</span>
          <div className="spacer" />
          <Link prefetch={false} href={`/dashboard/admin/usuarios/${caso.userId}`} className="small">
            Ver usuario →
          </Link>
        </div>
        <Conversacion mensajes={mensajes} lado="soporte" nombreUsuario={nombre} />
        <Responder id={caso.id} lado="soporte" placeholder={`Responder a ${nombre.split(" ")[0]}…`} />
        <form action={estadoCasoAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={caso.id} />
          <input type="hidden" name="lado" value="soporte" />
          <input type="hidden" name="estado" value={caso.estado === "cerrado" ? "abierto" : "cerrado"} />
          <button className="btn secondary small" type="submit">
            {caso.estado === "cerrado" ? "Volver a abrir" : "✓ Marcar como resuelto sin responder"}
          </button>
        </form>
      </div>
    </div>
  );
}
