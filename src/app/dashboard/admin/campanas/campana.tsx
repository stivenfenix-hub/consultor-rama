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
type Textos = { whatsapp: string; asunto: string; correo: string; notiTitulo: string; notiCuerpo: string };

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" });

/** Elegir abogados, ajustar los mensajes y dejarlos en cola (pide confirmar). */
export function CampanaFirma({ usuarios, plantillas, waVinculado }: { usuarios: Fila[]; plantillas: Textos; waVinculado: boolean }) {
  // Por defecto nadie: así se puede empezar por los de confianza (los de más procesos van arriba).
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [buscar, setBuscar] = useState("");
  const [canales, setCanales] = useState({ whatsapp: waVinculado, correo: true, notificacion: true });
  const [textos, setTextos] = useState<Textos>(plantillas);
  const [vista, setVista] = useState<"whatsapp" | "correo" | "notificacion">("whatsapp");
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  // PDF que acompaña la campaña (correo y WhatsApp). Se sube apenas se elige.
  const [adjunto, setAdjunto] = useState<{ id: number; nombre: string; bytes: number } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorAdjunto, setErrorAdjunto] = useState<string | null>(null);

  async function subirPdf(archivo: File | undefined) {
    setErrorAdjunto(null);
    setConfirmando(false);
    if (!archivo) return;
    if (archivo.size > 5 * 1024 * 1024) return setErrorAdjunto("El PDF pesa más de 5 MB.");
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      const r = await fetch("/api/admin/campana-adjunto", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErrorAdjunto(j.error ?? "No se pudo subir el PDF.");
      setAdjunto({ id: j.id, nombre: j.nombre, bytes: j.bytes });
    } catch {
      setErrorAdjunto("No se pudo subir el PDF. Revisa la conexión.");
    } finally {
      setSubiendo(false);
    }
  }

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
          <label className="check">
            <input
              type="checkbox"
              checked={canales.notificacion}
              onChange={(e) => { setCanales((c) => ({ ...c, notificacion: e.target.checked })); setConfirmando(false); }}
            />
            <span><b>Campanita y notificación push</b></span>
          </label>
        </div>
        <nav className="tabbar" style={{ marginBottom: 10 }}>
          <button type="button" className={`tab ${vista === "whatsapp" ? "active" : ""}`} onClick={() => setVista("whatsapp")}>
            📱 WhatsApp
          </button>
          <button type="button" className={`tab ${vista === "correo" ? "active" : ""}`} onClick={() => setVista("correo")}>
            📧 Correo
          </button>
          <button type="button" className={`tab ${vista === "notificacion" ? "active" : ""}`} onClick={() => setVista("notificacion")}>
            🔔 Notificación
          </button>
        </nav>
        {vista === "notificacion" ? (
          <div className="campana-editor">
            <div>
              <label className="small" style={{ display: "block", marginBottom: 6 }}>
                Título
                <input type="text" value={textos.notiTitulo} maxLength={80} onChange={(e) => editar({ notiTitulo: e.target.value })} />
              </label>
              <label className="small" style={{ display: "block" }}>
                Texto
                <textarea rows={4} value={textos.notiCuerpo} maxLength={200} onChange={(e) => editar({ notiCuerpo: e.target.value })} />
              </label>
              <p className="muted small">
                Llega al momento a la campanita de Estradox y como notificación push al celular o computador de quien
                las tenga activadas. Al tocarla abre Firma electrónica.
              </p>
            </div>
            <div className="campana-push">
              <div className="muted small" style={{ marginBottom: 6 }}>Así se ve la notificación:</div>
              <div className="campana-push-tarjeta">
                <span className="campana-push-icono">X</span>
                <div>
                  <b>{textos.notiTitulo}</b>
                  <div>{textos.notiCuerpo}</div>
                  <span className="muted small">Estradox · ahora</span>
                </div>
              </div>
            </div>
          </div>
        ) : vista === "whatsapp" ? (
          <div className="campana-editor">
            <textarea rows={16} value={textos.whatsapp} onChange={(e) => editar({ whatsapp: e.target.value })} />
            <div className="campana-previa wa">
              <div className="muted small" style={{ marginBottom: 6 }}>Así le llega a {ejemplo?.nombre ?? "el abogado"}:</div>
              <div className="campana-burbuja">{previa(textos.whatsapp)}</div>
              {adjunto && <div className="campana-burbuja" style={{ marginTop: 6 }}>📄 <b>{adjunto.nombre}</b></div>}
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
        <div className="row wrap" style={{ gap: 10, alignItems: "center", marginTop: 12 }}>
          <span className="small"><b>📎 PDF adjunto</b> (opcional, máx. 5 MB):</span>
          {adjunto ? (
            <>
              <span className="small">
                📄 {adjunto.nombre} · {(adjunto.bytes / 1024 / 1024).toFixed(1)} MB
              </span>
              <button type="button" className="btn small secondary" onClick={() => { setAdjunto(null); setConfirmando(false); }}>
                Quitar
              </button>
            </>
          ) : (
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={subiendo}
              onChange={(e) => {
                void subirPdf(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          )}
          {subiendo && <span className="small muted">Subiendo…</span>}
          {errorAdjunto && <span className="small error">{errorAdjunto}</span>}
        </div>
        {adjunto && (
          <p className="muted small" style={{ margin: "6px 0 0" }}>
            Va adjunto en el correo y, en WhatsApp, como documento justo después del mensaje.
          </p>
        )}
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
                canales.notificacion ? `${n} con campanita y push (al momento)` : null,
              ]
                .filter(Boolean)
                .join(", ") +
              ". " +
              (canales.whatsapp || canales.correo ? "WhatsApp y correos salen de a poco durante el día: no todos al mismo tiempo." : "")}
        </p>
        <button
          type="button"
          className={`btn ${confirmando ? "" : "secondary"}`}
          disabled={pending || subiendo || n === 0 || (!canales.whatsapp && !canales.correo && !canales.notificacion)}
          onClick={() => {
            if (!confirmando) {
              setConfirmando(true);
              setResultado(null);
              return;
            }
            start(async () => {
              setResultado(await enviarCampanaFirmaAction([...elegidos], canales, textos, adjunto?.id ?? null));
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
