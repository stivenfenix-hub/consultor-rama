"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { enviarCampanaFirmaAction } from "./actions";

type Fila = {
  id: string;
  nombre: string;
  email: string;
  telefono: string;
  procesos: number;
  ultimoWa: string | null;
  ultimoCorreo: string | null;
};
type Textos = { whatsapp: string; asunto: string; correo: string };

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" });

/** Elegir abogados, ajustar los mensajes y dejarlos en cola (pide confirmar). */
export function CampanaFirma({ usuarios, plantillas, waVinculado }: { usuarios: Fila[]; plantillas: Textos; waVinculado: boolean }) {
  // Por defecto nadie: así se puede empezar por los de confianza (los de más procesos van arriba).
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [buscar, setBuscar] = useState("");
  const [canales, setCanales] = useState({ whatsapp: waVinculado, correo: true });
  const [textos, setTextos] = useState<Textos>(plantillas);
  const [vista, setVista] = useState<"whatsapp" | "correo">("whatsapp");
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return q ? usuarios.filter((u) => `${u.nombre} ${u.email} ${u.telefono}`.toLowerCase().includes(q)) : usuarios;
  }, [usuarios, buscar]);
  const n = elegidos.size;
  const elegidosLista = usuarios.filter((u) => elegidos.has(u.id));
  const conWa = elegidosLista.filter((u) => u.telefono.length >= 10).length;

  const cambiar = (s: Set<string>) => {
    setConfirmando(false);
    setElegidos(s);
  };
  const marcar = (id: string, si: boolean) => {
    const t = new Set(elegidos);
    if (si) t.add(id);
    else t.delete(id);
    cambiar(t);
  };
  const editar = (c: Partial<Textos>) => {
    setTextos((t) => ({ ...t, ...c }));
    setConfirmando(false);
  };

  // Vista previa con un abogado de ejemplo (el primero elegido o el primero de la lista).
  const ejemplo = elegidosLista[0] ?? usuarios[0];
  const apellido = ejemplo?.nombre.trim().split(/\s+/).slice(-2)[0] ?? "";
  const previa = (t: string) =>
    t
      .replace(/\{apellido\}/g, apellido)
      .replace(/\{nombre\}/g, ejemplo?.nombre.split(/\s+/)[0] ?? "")
      .replace(/\{enlace\}/g, "https://app.estradox.com/dashboard/firmas");

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>1. Mensajes</h2>
        <div className="row wrap" style={{ gap: 16, marginBottom: 10 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={canales.whatsapp}
              disabled={!waVinculado}
              onChange={(e) => { setCanales((c) => ({ ...c, whatsapp: e.target.checked })); setConfirmando(false); }}
            />
            <span>Enviar por <b>WhatsApp</b> (comercial)</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={canales.correo}
              onChange={(e) => { setCanales((c) => ({ ...c, correo: e.target.checked })); setConfirmando(false); }}
            />
            <span>Enviar por <b>correo</b></span>
          </label>
        </div>
        <nav className="tabbar" style={{ marginBottom: 10 }}>
          <button type="button" className={`tab ${vista === "whatsapp" ? "active" : ""}`} onClick={() => setVista("whatsapp")}>
            📱 WhatsApp
          </button>
          <button type="button" className={`tab ${vista === "correo" ? "active" : ""}`} onClick={() => setVista("correo")}>
            📧 Correo
          </button>
        </nav>
        {vista === "whatsapp" ? (
          <div className="campana-editor">
            <textarea rows={16} value={textos.whatsapp} onChange={(e) => editar({ whatsapp: e.target.value })} />
            <div className="campana-previa wa">
              <div className="muted small" style={{ marginBottom: 6 }}>Así le llega a {ejemplo?.nombre ?? "el abogado"}:</div>
              <div className="campana-burbuja">{previa(textos.whatsapp)}</div>
            </div>
          </div>
        ) : (
          <>
            <label className="small" style={{ display: "block", marginBottom: 6 }}>
              Asunto
              <input type="text" value={textos.asunto} maxLength={200} onChange={(e) => editar({ asunto: e.target.value })} />
            </label>
            <textarea rows={20} value={textos.correo} onChange={(e) => editar({ correo: e.target.value })} />
          </>
        )}
        <div className="muted small" style={{ marginTop: 6 }}>
          <code>{"{apellido}"}</code> = primer apellido del abogado · <code>{"{nombre}"}</code> = su nombre ·{" "}
          <code>{"{enlace}"}</code> = enlace a Firma electrónica · en el correo, <code>**texto**</code> va en negrilla y la
          línea <code>{"{boton}"}</code> es el botón «Enviar mi primer documento GRATIS».{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              editar(plantillas);
            }}
          >
            Volver a los textos originales
          </a>
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>2. ¿A quiénes?</h2>
          <span className="spacer" />
          <strong className="small">{n} elegido(s)</strong>
          <button type="button" className="btn small secondary" onClick={() => cambiar(new Set(visibles.map((u) => u.id)))}>
            Todos{buscar ? " los filtrados" : ""}
          </button>
          <button type="button" className="btn small secondary" onClick={() => cambiar(new Set())}>
            Ninguno
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Consejo: empiece por los abogados de confianza que más procesos tienen (van arriba). Cuando los vea usar su
          firma gratis, envíela al resto.
        </p>
        <input type="search" placeholder="Buscar por nombre, correo o WhatsApp" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {usuarios.length === 0 ? (
          <p className="muted small">No hay abogados que cumplan en este momento.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Abogado</th>
                  <th>Procesos</th>
                  <th>WhatsApp</th>
                  <th>Ya recibió</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Elegir a ${u.nombre}`}
                        checked={elegidos.has(u.id)}
                        onChange={(e) => marcar(u.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      <Link prefetch={false} href={`/dashboard/admin/usuarios/${u.id}`}>{u.nombre}</Link>
                      <div className="small muted">{u.email}</div>
                    </td>
                    <td className="small"><b>{u.procesos}</b></td>
                    <td className="small">{u.telefono || <span className="muted">Sin número</span>}</td>
                    <td className="small muted">
                      {u.ultimoWa && <div>📱 {fecha(u.ultimoWa)}</div>}
                      {u.ultimoCorreo && <div>📧 {fecha(u.ultimoCorreo)}</div>}
                      {!u.ultimoWa && !u.ultimoCorreo && "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card campana-enviar">
        <h2 style={{ marginTop: 0 }}>3. Enviar</h2>
        <p className="small" style={{ marginTop: 0 }}>
          {n === 0
            ? "Elige al menos un abogado."
            : [
                canales.whatsapp ? `${conWa} por WhatsApp${n - conWa ? ` (${n - conWa} sin número)` : ""}` : null,
                canales.correo ? `${n} por correo` : null,
              ]
                .filter(Boolean)
                .join(" y ") + ". Salen de a poco durante el día: no todos al mismo tiempo."}
        </p>
        <button
          type="button"
          className={`btn ${confirmando ? "" : "secondary"}`}
          disabled={pending || n === 0 || (!canales.whatsapp && !canales.correo)}
          onClick={() => {
            if (!confirmando) {
              setConfirmando(true);
              setResultado(null);
              return;
            }
            start(async () => {
              setResultado(await enviarCampanaFirmaAction([...elegidos], canales, textos));
              setConfirmando(false);
              setElegidos(new Set());
            });
          }}
        >
          {pending ? "Poniendo en cola…" : confirmando ? `Sí, enviar a ${n} abogado(s)` : `Enviar campaña a ${n}`}
        </button>
        {confirmando && !pending && (
          <span className="small muted" style={{ marginLeft: 10 }}>Toca otra vez para confirmar.</span>
        )}
        {resultado && (
          <div className={`small ${resultado.error ? "error" : "ok"}`} style={{ marginTop: 8 }}>
            {resultado.error ?? resultado.ok}
          </div>
        )}
      </div>
    </>
  );
}
