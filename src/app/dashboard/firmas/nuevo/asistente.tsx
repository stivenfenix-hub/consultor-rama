"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { PdfPaginas } from "@/components/pdf-paginas";
import { enviarDocumentoAction, type FirmanteForm } from "../actions";

type Campo = {
  clave: string;
  etiqueta: string;
  ejemplo?: string;
  tipo?: "texto" | "largo" | "opcion";
  opciones?: string[];
  opcional?: boolean;
  medio?: boolean;
};
export type PlantillaVista = { id: string; nombre: string; descripcion: string; norma: string; campos: Campo[] };
type Sugerida = { rol: string; nombre: string; doc: string; page: number; x: number; y: number; width: number; height: number };
type Borrador = { id: string; titulo: string; paginas: number };

const PASOS = ["Documento", "Firmantes", "Ubicar firmas", "Enviar"];
const COLORES = ["#8b3dff", "#2f81f7", "#17914c", "#d97706", "#db2777", "#0891b2", "#7c3aed", "#dc2626", "#4d7c0f", "#b45309"];
const TIPOS_DOC: [string, string][] = [
  ["CC", "Cédula de ciudadanía"],
  ["CE", "Cédula de extranjería"],
  ["NIT", "NIT"],
  ["PAS", "Pasaporte"],
];
const NIVELES_VISTA: { k: "otp" | "cedula" | "biometrica"; t: string; d: string }[] = [
  { k: "otp", t: "Solo código", d: "Código de 6 dígitos al correo o WhatsApp. Lo más rápido para el cliente." },
  { k: "cedula", t: "Código + cédula", d: "Además toma fotos de su cédula por ambos lados; leemos el número y lo comparamos." },
  {
    k: "biometrica",
    t: "Código + cédula + rostro",
    d: "Además una selfie con prueba de vida (parpadear y girar la cabeza) que se compara con la foto de la cédula.",
  },
];
const ANCHO = 0.3;
const ALTO = 0.075;
const vacio = (): FirmanteForm => ({ nombre: "", tipoDoc: "CC", numDoc: "", email: "", telefono: "", posicion: null });
const limite = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function Asistente({
  plantillas,
  borrador,
  firmantesIniciales,
}: {
  plantillas: PlantillaVista[];
  /** Borrador que se está retomando (entra directo al paso 2). */
  borrador: Borrador | null;
  firmantesIniciales: FirmanteForm[];
}) {
  const router = useRouter();
  const [paso, setPaso] = useState(borrador ? 1 : 0);
  const [doc, setDoc] = useState<Borrador | null>(borrador);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Paso 1
  const [modo, setModo] = useState<"pdf" | "plantilla">("pdf");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [plantillaId, setPlantillaId] = useState(plantillas[0]?.id ?? "");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [titulo, setTitulo] = useState("");
  const [radicado, setRadicado] = useState("");
  const plantilla = plantillas.find((p) => p.id === plantillaId) ?? null;

  // Pasos 2 y 3
  const [firmantes, setFirmantes] = useState<FirmanteForm[]>(firmantesIniciales.length ? firmantesIniciales : [vacio()]);
  const [activo, setActivo] = useState(0);

  // Paso 4
  const [otpCorreo, setOtpCorreo] = useState(true);
  const [otpWhatsapp, setOtpWhatsapp] = useState(false);
  const [verificacion, setVerificacion] = useState<"otp" | "cedula" | "biometrica">("otp");
  const [enviando, enviar] = useTransition();

  const cambiar = (i: number, c: Partial<FirmanteForm>) =>
    setFirmantes((fs) => fs.map((f, j) => (j === i ? { ...f, ...c } : f)));

  async function crearBorrador() {
    setError(null);
    const fd = new FormData();
    fd.set("titulo", titulo);
    fd.set("radicado", radicado);
    if (modo === "pdf") {
      if (!archivo) return setError("Elige el PDF que quieres enviar a firmar.");
      fd.set("archivo", archivo);
    } else {
      if (!plantilla) return setError("Elige una plantilla.");
      const falta = plantilla.campos.find((c) => !c.opcional && !(valores[c.clave] ?? c.opciones?.[0] ?? "").trim());
      if (falta) return setError(`Falta llenar: ${falta.etiqueta}.`);
      const v: Record<string, string> = {};
      for (const c of plantilla.campos) v[c.clave] = valores[c.clave] ?? c.opciones?.[0] ?? "";
      fd.set("plantilla", plantilla.id);
      fd.set("valores", JSON.stringify(v));
    }
    setOcupado(true);
    try {
      const r = await fetch("/api/firmas", { method: "POST", body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.id) return setError(j?.error ?? "No pudimos crear el documento. Intenta de nuevo.");
      setDoc({ id: j.id, titulo: j.titulo, paginas: j.paginas });
      // La plantilla ya sabe quién firma y dónde: se proponen.
      const sugeridas: Sugerida[] = Array.isArray(j.sugeridas) ? j.sugeridas : [];
      if (sugeridas.length) {
        setFirmantes(
          sugeridas.map((s) => ({
            ...vacio(),
            nombre: s.nombre,
            numDoc: s.doc.replace(/[^\dA-Za-z]/g, ""),
            posicion: { page: s.page, x: s.x, y: s.y, width: s.width, height: s.height },
          })),
        );
      }
      setPaso(1);
      window.scrollTo({ top: 0 });
    } catch {
      setError("No hay conexión. Intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  function validarFirmantes(): string | null {
    for (const [i, f] of firmantes.entries()) {
      const n = i + 1;
      if (f.nombre.trim().length < 5) return `Firmante ${n}: escribe el nombre completo.`;
      if (f.numDoc.trim().length < 4) return `Firmante ${n}: escribe el número de documento.`;
      if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return `Firmante ${n}: el correo no es válido.`;
      const tel = f.telefono.replace(/\D/g, "");
      if (tel && tel.length < 10) return `Firmante ${n}: el WhatsApp debe tener 10 dígitos.`;
      if (!f.email.trim() && !tel) return `Firmante ${n}: necesita un correo o un WhatsApp para recibir el enlace.`;
    }
    return null;
  }

  function irA(n: number) {
    setError(null);
    if (n >= 2) {
      const e = validarFirmantes();
      if (e) return setError(e);
    }
    if (n === 2 && doc) {
      // Quien no tenga sitio todavía queda al final de la última página, uno al lado del otro.
      setFirmantes((fs) => {
        let k = 0;
        return fs.map((f) => {
          if (f.posicion) return f;
          const col = k % 2;
          const fila = Math.floor(k / 2);
          k++;
          return {
            ...f,
            posicion: { page: doc.paginas, x: col ? 0.58 : 0.12, y: limite(0.8 - fila * 0.11, 0.05, 0.9), width: ANCHO, height: ALTO },
          };
        });
      });
    }
    if (n === 3) {
      if (firmantes.some((f) => !f.posicion)) return setError("Ubica la firma de todos los firmantes.");
      // Por defecto se usan los medios que todos tienen.
      const todosCorreo = firmantes.every((f) => f.email.trim());
      const todosWa = firmantes.every((f) => f.telefono.replace(/\D/g, ""));
      setOtpCorreo(todosCorreo || !todosWa);
      setOtpWhatsapp(!todosCorreo && todosWa);
    }
    setPaso(n);
    window.scrollTo({ top: 0 });
  }

  function enviarYa() {
    if (!doc) return;
    setError(null);
    enviar(async () => {
      const r = await enviarDocumentoAction(doc.id, firmantes, { otpCorreo, otpWhatsapp, verificacion });
      if (r.error) return setError(r.error);
      router.push(`/dashboard/firmas/${doc.id}`);
    });
  }

  return (
    <>
      <ol className="firma-pasos">
        {PASOS.map((p, i) => (
          <li key={p} className={i === paso ? "actual" : i < paso ? "hecho" : ""}>
            <span>{i < paso ? <Icon name="check" size={14} /> : i + 1}</span>
            {p}
          </li>
        ))}
      </ol>

      {/* ---------- Paso 1: documento ---------- */}
      {paso === 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>¿Qué documento vas a enviar a firmar?</h2>
          <div className="firma-opciones">
            <button type="button" className={`firma-opcion ${modo === "pdf" ? "sel" : ""}`} onClick={() => setModo("pdf")}>
              <Icon name="file" size={22} />
              <b>Subir un PDF</b>
              <span className="muted small">Un documento que ya tienes listo.</span>
            </button>
            <button type="button" className={`firma-opcion ${modo === "plantilla" ? "sel" : ""}`} onClick={() => setModo("plantilla")}>
              <Icon name="firma" size={22} />
              <b>Usar una plantilla legal</b>
              <span className="muted small">Llenas los datos y Estradox redacta el documento.</span>
            </button>
          </div>

          {modo === "pdf" ? (
            <div style={{ marginTop: 16 }}>
              <label className="firma-subir">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setArchivo(f);
                    if (f && !titulo) setTitulo(f.name.replace(/\.pdf$/i, ""));
                  }}
                />
                <Icon name="download" size={26} />
                <b>{archivo ? archivo.name : "Toca para elegir el PDF"}</b>
                <span className="muted small">
                  {archivo ? `${(archivo.size / 1024 / 1024).toFixed(2)} MB` : "Máximo 15 MB, sin contraseña."}
                </span>
              </label>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <div className="firma-plantillas">
                {plantillas.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`firma-plantilla ${p.id === plantillaId ? "sel" : ""}`}
                    onClick={() => setPlantillaId(p.id)}
                  >
                    <b>{p.nombre}</b>
                    <span className="cert-norma">{p.norma}</span>
                    <span className="muted small">{p.descripcion}</span>
                  </button>
                ))}
              </div>
              {plantilla && (
                <div className="firma-campos">
                  {plantilla.campos.map((c) => (
                    <label key={c.clave} className={c.medio ? "medio" : ""}>
                      <span className="small">
                        {c.etiqueta}
                        {c.opcional && <span className="muted"> (opcional)</span>}
                      </span>
                      {c.tipo === "opcion" ? (
                        <select
                          value={valores[c.clave] ?? c.opciones?.[0] ?? ""}
                          onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
                        >
                          {c.opciones?.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : c.tipo === "largo" ? (
                        <textarea
                          rows={2}
                          placeholder={c.ejemplo}
                          value={valores[c.clave] ?? ""}
                          onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder={c.ejemplo}
                          value={valores[c.clave] ?? ""}
                          onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="firma-campos" style={{ marginTop: 16 }}>
            <label className="medio">
              <span className="small">
                Título del documento{modo === "plantilla" && <span className="muted"> (opcional: lo ponemos por ti)</span>}
              </span>
              <input type="text" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} placeholder="Poder especial - María Gómez" />
            </label>
            <label className="medio">
              <span className="small">
                Radicado del proceso <span className="muted">(opcional, 23 dígitos)</span>
              </span>
              <input type="text" inputMode="numeric" value={radicado} maxLength={30} onChange={(e) => setRadicado(e.target.value)} placeholder="05001310302120240028100" />
            </label>
          </div>
        </div>
      )}

      {/* ---------- Paso 2: firmantes ---------- */}
      {paso === 1 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>¿Quiénes firman?</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            A cada uno le llega su enlace personal. Para firmar confirma su identidad con un código que le enviamos al
            correo o al WhatsApp que pongas aquí.
          </p>
          {firmantes.map((f, i) => (
            <div key={i} className="firma-firmante" style={{ borderLeftColor: COLORES[i % COLORES.length] }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <b>Firmante {i + 1}</b>
                <div className="spacer" />
                {firmantes.length > 1 && (
                  <button type="button" className="btn secondary small" onClick={() => setFirmantes((fs) => fs.filter((_, j) => j !== i))}>
                    Quitar
                  </button>
                )}
              </div>
              <div className="firma-campos">
                <label>
                  <span className="small">Nombre completo</span>
                  <input type="text" value={f.nombre} maxLength={120} onChange={(e) => cambiar(i, { nombre: e.target.value })} placeholder="María Fernanda Gómez Ríos" />
                </label>
                <label className="medio">
                  <span className="small">Tipo de documento</span>
                  <select value={f.tipoDoc} onChange={(e) => cambiar(i, { tipoDoc: e.target.value })}>
                    {TIPOS_DOC.map(([k, t]) => (
                      <option key={k} value={k}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="medio">
                  <span className="small">Número de documento</span>
                  <input type="text" value={f.numDoc} maxLength={30} onChange={(e) => cambiar(i, { numDoc: e.target.value })} placeholder="43123456" />
                </label>
                <label className="medio">
                  <span className="small">Correo</span>
                  <input type="email" value={f.email} maxLength={160} onChange={(e) => cambiar(i, { email: e.target.value })} placeholder="maria@correo.com" />
                </label>
                <label className="medio">
                  <span className="small">WhatsApp</span>
                  <input type="tel" inputMode="numeric" value={f.telefono} maxLength={15} onChange={(e) => cambiar(i, { telefono: e.target.value })} placeholder="3001234567" />
                </label>
              </div>
            </div>
          ))}
          {firmantes.length < 10 && (
            <button type="button" className="btn secondary" onClick={() => setFirmantes((fs) => [...fs, vacio()])}>
              + Agregar otro firmante
            </button>
          )}
        </div>
      )}

      {/* ---------- Paso 3: ubicar firmas ---------- */}
      {paso === 2 && doc && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Ubica la firma de cada uno</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Elige un firmante y <b>toca el documento</b> donde debe quedar su firma. Después puedes arrastrar el recuadro
            o cambiarle el tamaño desde la esquina.
          </p>
          <div className="firma-chips">
            {firmantes.map((f, i) => (
              <button
                key={i}
                type="button"
                className={`firma-chip ${i === activo ? "sel" : ""}`}
                style={{ ["--c" as string]: COLORES[i % COLORES.length] }}
                onClick={() => setActivo(i)}
              >
                <i />
                {f.nombre.trim() || `Firmante ${i + 1}`}
                {f.posicion && <span className="muted"> · pág. {f.posicion.page}</span>}
              </button>
            ))}
          </div>
          <div className="firma-editor">
            <PdfPaginas
              src={`/api/firmas/${doc.id}/pdf?inline=1`}
              alClic={(pagina, x, y) => {
                const act = firmantes[activo];
                const w = act?.posicion?.width ?? ANCHO;
                const h = act?.posicion?.height ?? ALTO;
                cambiar(activo, {
                  posicion: { page: pagina, x: limite(x - w / 2, 0, 1 - w), y: limite(y - h / 2, 0, 1 - h), width: w, height: h },
                });
              }}
              sobre={(pagina) =>
                firmantes.map((f, i) =>
                  f.posicion?.page === pagina ? (
                    <Recuadro
                      key={i}
                      nombre={f.nombre.trim() || `Firmante ${i + 1}`}
                      color={COLORES[i % COLORES.length]}
                      activo={i === activo}
                      pos={f.posicion}
                      alTocar={() => setActivo(i)}
                      alCambiar={(p) => cambiar(i, { posicion: { ...f.posicion!, ...p } })}
                    />
                  ) : null,
                )
              }
            />
          </div>
        </div>
      )}

      {/* ---------- Paso 4: enviar ---------- */}
      {paso === 3 && doc && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Revisa y envía</h2>
          <div className="firma-resumen">
            <div>
              <span className="muted small">Documento</span>
              <b>{doc.titulo}</b>
              <span className="muted small">{doc.paginas} página(s)</span>
            </div>
            <div>
              <span className="muted small">Firmantes ({firmantes.length})</span>
              {firmantes.map((f, i) => (
                <span key={i} className="small">
                  <i style={{ background: COLORES[i % COLORES.length] }} /> {f.nombre} ·{" "}
                  <span className="muted">{[f.email, f.telefono].filter((x) => x.trim()).join(" · ")}</span>
                </span>
              ))}
            </div>
          </div>
          <h3 style={{ marginBottom: 6 }}>Código de verificación (OTP)</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Antes de firmar, cada persona debe escribir un código de 6 dígitos que le enviamos. Es lo que prueba que
            quien firma es el dueño de ese correo o WhatsApp.
          </p>
          <label className="check">
            <input type="checkbox" checked={otpCorreo} onChange={(e) => setOtpCorreo(e.target.checked)} />
            <span>Enviar el código por <b>correo</b></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={otpWhatsapp} onChange={(e) => setOtpWhatsapp(e.target.checked)} />
            <span>Enviar el código por <b>WhatsApp</b></span>
          </label>
          <h3 style={{ marginBottom: 6 }}>Verificación de identidad</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Elige cuánto debe probar cada firmante que es quien dice ser. Para un pagaré o un contrato de valor alto,
            pide la cédula y el rostro.
          </p>
          <div className="identidad-nivel">
            {NIVELES_VISTA.map((n) => (
              <label key={n.k} className={verificacion === n.k ? "sel" : ""}>
                <input type="radio" name="verificacion" checked={verificacion === n.k} onChange={() => setVerificacion(n.k)} />
                <span>
                  <b>{n.t}</b>
                  <span className="muted small" style={{ display: "block" }}>{n.d}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="muted small">
            El enlace para firmar vence en 30 días. Cuando firmen todos, cada uno recibe el PDF sellado con su
            certificado de auditoría.
          </p>
        </div>
      )}

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="firma-nav">
        {paso > (borrador ? 1 : 0) && paso > 0 && (
          <button type="button" className="btn secondary" disabled={ocupado || enviando} onClick={() => { setError(null); setPaso(paso - 1); }}>
            ← Atrás
          </button>
        )}
        <div className="spacer" />
        {paso === 0 && (
          <button type="button" className="btn" disabled={ocupado} onClick={crearBorrador}>
            {ocupado ? "Preparando…" : "Continuar →"}
          </button>
        )}
        {(paso === 1 || paso === 2) && (
          <button type="button" className="btn" onClick={() => irA(paso + 1)}>
            Continuar →
          </button>
        )}
        {paso === 3 && (
          <button type="button" className="btn" disabled={enviando} onClick={enviarYa}>
            <Icon name="send" size={16} /> {enviando ? "Enviando…" : "Enviar a firmar"}
          </button>
        )}
      </div>
    </>
  );
}

type Pos = { page: number; x: number; y: number; width: number; height: number };

/** Recuadro de firma: se arrastra para mover y desde la esquina para cambiar el tamaño. */
function Recuadro({
  nombre,
  color,
  activo,
  pos,
  alTocar,
  alCambiar,
}: {
  nombre: string;
  color: string;
  activo: boolean;
  pos: Pos;
  alTocar: () => void;
  alCambiar: (p: Partial<Pos>) => void;
}) {
  const inicio = useRef<{ px: number; py: number; pos: Pos; w: number; h: number; modo: "mover" | "tam" } | null>(null);

  const empezar = (modo: "mover" | "tam") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    alTocar();
    const pagina = e.currentTarget.closest(".pdf-pagina")?.getBoundingClientRect();
    if (!pagina) return;
    inicio.current = { px: e.clientX, py: e.clientY, pos, w: pagina.width, h: pagina.height, modo };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const mover = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = inicio.current;
    if (!s) return;
    const dx = (e.clientX - s.px) / s.w;
    const dy = (e.clientY - s.py) / s.h;
    if (s.modo === "mover") {
      alCambiar({ x: limite(s.pos.x + dx, 0, 1 - s.pos.width), y: limite(s.pos.y + dy, 0, 1 - s.pos.height) });
    } else {
      alCambiar({
        width: limite(s.pos.width + dx, 0.12, 1 - s.pos.x),
        height: limite(s.pos.height + dy, 0.035, 1 - s.pos.y),
      });
    }
  };
  const soltar = () => {
    inicio.current = null;
  };

  return (
    <div
      className={`firma-recuadro ${activo ? "sel" : ""}`}
      style={{
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        width: `${pos.width * 100}%`,
        height: `${pos.height * 100}%`,
        ["--c" as string]: color,
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={empezar("mover")}
      onPointerMove={mover}
      onPointerUp={soltar}
      onPointerCancel={soltar}
    >
      <span>Firma de {nombre}</span>
      <div className="firma-asa" onPointerDown={empezar("tam")} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar} />
    </div>
  );
}
