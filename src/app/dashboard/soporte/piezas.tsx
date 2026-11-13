import Link from "next/link";
import {
  ESTADOS_SOPORTE,
  TIPOS_SOPORTE,
  type CasoSoporte,
  type EstadoSoporte,
  type MensajeSoporte,
} from "@/lib/soporte";

export const fechaHora = (d: Date | string) =>
  new Date(d).toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const CLASE_ESTADO: Record<EstadoSoporte, string> = { abierto: "warn", respondido: "new", cerrado: "" };

export function EtiquetaEstado({ estado, lado }: { estado: EstadoSoporte; lado: "usuario" | "soporte" }) {
  // Para el root, "abierto" es lo que le toca contestar.
  const texto = lado === "soporte" && estado === "abierto" ? "Por responder" : ESTADOS_SOPORTE[estado];
  return <span className={`badge ${CLASE_ESTADO[estado]}`}>{texto}</span>;
}

export function TipoCaso({ tipo }: { tipo: string }) {
  const t = TIPOS_SOPORTE[tipo as keyof typeof TIPOS_SOPORTE] ?? TIPOS_SOPORTE.ayuda;
  return (
    <span className="muted small">
      {t.emoji} {t.label}
    </span>
  );
}

/** Fila de la lista de casos (abogado o root). */
export function FilaCaso({ c, href, lado }: { c: CasoSoporte; href: string; lado: "usuario" | "soporte" }) {
  const sinLeer = lado === "usuario" ? !c.vistoUsuario : !c.vistoSoporte;
  return (
    <Link prefetch={false} href={href} className={`case soporte-fila ${sinLeer ? "sin-leer" : ""}`}>
      <div className="row wrap" style={{ gap: 8 }}>
        <b style={{ minWidth: 0, overflowWrap: "anywhere" }}>{c.asunto}</b>
        {sinLeer && <span className="badge new">{lado === "usuario" ? "Nueva respuesta" : "Nuevo"}</span>}
        <div className="spacer" />
        <EtiquetaEstado estado={c.estado} lado={lado} />
      </div>
      <div className="row wrap" style={{ gap: 10, marginTop: 4 }}>
        <TipoCaso tipo={c.tipo} />
        {lado === "soporte" && <span className="small">{c.nombre ?? c.email}</span>}
        <div className="spacer" />
        <span className="muted small">{fechaHora(c.updatedAt)}</span>
      </div>
      {c.ultimo && (
        <div className="muted small" style={{ marginTop: 4 }}>
          {c.ultimoAutor === "soporte" ? "Estradox: " : lado === "soporte" ? "" : "Tú: "}
          {c.ultimo}
          {c.ultimo.length >= 160 ? "…" : ""}
        </div>
      )}
    </Link>
  );
}

/** Conversación tipo chat: lo del lado que mira va a la derecha. */
export function Conversacion({
  mensajes,
  lado,
  nombreUsuario,
}: {
  mensajes: MensajeSoporte[];
  lado: "usuario" | "soporte";
  nombreUsuario: string;
}) {
  return (
    <div className="soporte-chat">
      {mensajes.map((m) => {
        const mio = m.autor === lado;
        return (
          <div key={m.id} className={`soporte-msg ${mio ? "mio" : ""} ${m.autor}`}>
            <div className="soporte-msg-autor small">
              {m.autor === "soporte" ? "Soporte Estradox" : lado === "usuario" ? "Tú" : nombreUsuario} ·{" "}
              <span className="muted">{fechaHora(m.createdAt)}</span>
            </div>
            <div className="soporte-msg-texto">{m.texto}</div>
          </div>
        );
      })}
    </div>
  );
}
