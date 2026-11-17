"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { buscarPersonas, leerTextoDocumento, type Avance, type Persona } from "./extraer";
import { ubicarFirmas } from "./ubicar";
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
    d: "Además una selfie con prueba de vida (girar la cabeza) que se compara con la foto de la cédula.",
  },
];
const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
const ANCHO = 0.3;
const ALTO = 0.075;
const vacio = (): FirmanteForm => ({ nombre: "", tipoDoc: "CC", numDoc: "", email: "", telefono: "", posicion: null });
const desdePersona = (p: Persona): FirmanteForm => ({
  nombre: p.nombre,
  tipoDoc: p.tipoDoc,
  numDoc: p.numDoc,
  email: p.email,
  telefono: p.telefono,
  posicion: null,
});
const limite = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function Asistente({
  plantillas,
  borrador,
  firmantesIniciales,
  cobro,
}: {
  plantillas: PlantillaVista[];
  /** Precio por nivel; gratis = su primer documento (o cuenta administradora). */
  cobro: {
    gratis: boolean;
    motivo: "primera" | "admin" | null;
    precios: Record<"otp" | "cedula" | "biometrica", number>;
  };
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
  // Por defecto el código va por WhatsApp; el correo, desmarcado.
  const [otpCorreo, setOtpCorreo] = useState(false);
  const [otpWhatsapp, setOtpWhatsapp] = useState(true);
  const [verificacion, setVerificacion] = useState<"otp" | "cedula" | "biometrica">("otp");
  const [enviando, enviar] = useTransition();

  const cambiar = (i: number, c: Partial<FirmanteForm>) =>
    setFirmantes((fs) => fs.map((f, j) => (j === i ? { ...f, ...c } : f)));

  // Firmantes leídos del documento (texto del PDF u OCR), para autollenar.
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [avance, setAvance] = useState<Avance>({ etapa: "Abriendo el documento…", pct: 0 });
  const leido = useRef<string | null>(null);
  // Firmantes cuya firma ya se ubicó sola (para no volver a moverla).
  const ubicados = useRef(new Set<string>());
  const [ubicando, setUbicando] = useState(false);
  const delDocumento = new Set((personas ?? []).map((p) => p.numDoc));
  const usados = new Set(firmantes.map((f) => f.numDoc.replace(/\D/g, "")).filter(Boolean));
  const siguiente = (personas ?? []).find((p) => !usados.has(p.numDoc)) ?? null;

  useEffect(() => {
    if (paso !== 1 || !doc || leido.current === doc.id) return;
    leido.current = doc.id;
    let vivo = true;
    setBuscando(true);
    setAvance({ etapa: "Abriendo el documento…", pct: 0 });
    const inicio = Date.now();
    leerTextoDocumento(doc.id, (a) => vivo && setAvance(a))
      // Aunque el PDF se lea en un instante, la barra se deja ver un momento.
      .then(async (texto) => {
        setAvance({ etapa: "Buscando a los firmantes…", pct: 100 });
        await new Promise((r) => setTimeout(r, Math.max(0, 1500 - (Date.now() - inicio))));
        return texto;
      })
      .then((texto) => {
        if (!vivo) return;
        const encontradas = buscarPersonas(texto);
        setPersonas(encontradas);
        // Llena, en orden, los firmantes que siguen vacíos (el primero y los que se hayan agregado).
        setFirmantes((fs) => {
          const ya = new Set(fs.map((f) => f.numDoc.replace(/\D/g, "")).filter(Boolean));
          const libres = encontradas.filter((p) => !ya.has(p.numDoc));
          return fs.map((f) => {
            const vacioDeltodo = !f.nombre.trim() && !f.numDoc.trim() && !f.email.trim() && !f.telefono.trim();
            const p = vacioDeltodo ? libres.shift() : undefined;
            if (p) return { ...desdePersona(p), posicion: f.posicion };
            // Ya tenía nombre y documento (p. ej. de la plantilla): completa correo y WhatsApp.
            const mismo = encontradas.find((x) => x.numDoc === f.numDoc.replace(/\D/g, ""));
            return mismo
              ? { ...f, email: f.email || mismo.email, telefono: f.telefono || mismo.telefono }
              : f;
          });
        });
      })
      .catch(() => vivo && setPersonas([]))
      .finally(() => vivo && setBuscando(false));
    return () => {
      vivo = false;
    };
  }, [paso, doc]);

  async function crearBorrador() {
    setError(null);
    const fd = new FormData();
    fd.set("titulo", titulo);
    fd.set("radicado", radicado);
    if (modo === "pdf") {
      if (!archivo) return setError("Elige el PDF o Word que quieres enviar a firmar.");
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
      // Primero un sitio provisional (al final de la última página)…
      let k = 0;
      const conSitio = firmantes.map((f) => {
        if (f.posicion) return f;
        const col = k % 2;
        const fila = Math.floor(k / 2);
        k++;
        return {
          ...f,
          posicion: { page: doc.paginas, x: col ? 0.58 : 0.12, y: limite(0.8 - fila * 0.11, 0.05, 0.9), width: ANCHO, height: ALTO },
        };
      });
      setFirmantes(conSitio);
      // …y luego el lugar limpio encima de su nombre, sin tapar letras ni líneas.
      const clave = (f: FirmanteForm) => `${doc.id}|${f.numDoc}|${f.nombre}`;
      const pendientes = conSitio.filter((f) => !ubicados.current.has(clave(f)));
      if (pendientes.length) {
        pendientes.forEach((f) => ubicados.current.add(clave(f)));
        setUbicando(true);
        ubicarFirmas(doc.id, conSitio, { width: ANCHO, height: ALTO })
          .then((sugeridas) =>
            setFirmantes((fs) =>
              fs.map((f, i) => {
                const s = sugeridas[i];
                const antes = conSitio[i];
                // Solo si el abogado no la ha movido mientras tanto, y si es alguien pendiente.
                if (!s || !antes || f.posicion !== antes.posicion || !pendientes.includes(antes)) return f;
                return { ...f, posicion: s };
              }),
            ),
          )
          .catch(() => {})
          .finally(() => setUbicando(false));
      }
    }
    if (n === 3) {
      if (firmantes.some((f) => !f.posicion)) return setError("Ubica la firma de todos los firmantes.");
      // WhatsApp marcado por defecto; el correo solo si a alguien le falta el WhatsApp.
      const algunWa = firmantes.some((f) => f.telefono.replace(/\D/g, ""));
      const todosWa = firmantes.every((f) => f.telefono.replace(/\D/g, ""));
      setOtpWhatsapp(algunWa);
      setOtpCorreo(!todosWa);
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
      if (r.pagar) {
        // Primero el pago en Bold; al volver se envía solo.
        window.location.href = r.pagar;
        return;
      }
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
              <b>Subir un PDF o Word</b>
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
                  accept="application/pdf,.pdf,.docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setArchivo(f);
                    if (f && !titulo) setTitulo(f.name.replace(/\.(pdf|docx|doc)$/i, ""));
                  }}
                />
                <Icon name="download" size={26} />
                <b>{archivo ? archivo.name : "Toca para elegir el PDF o Word"}</b>
                <span className="muted small">
                  {archivo
                    ? `${(archivo.size / 1024 / 1024).toFixed(2)} MB${/\.docx?$/i.test(archivo.name) ? " · lo convertimos a PDF" : ""}`
                    : "PDF o Word (.docx, .doc). Máximo 15 MB, sin contraseña."}
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
          {buscando ? (
            <div className="firma-lector buscando" role="status" aria-live="polite">
              <div className="row" style={{ gap: 8 }}>
                <span className="firma-lector-lupa">🔍</span>
                <b className="small">Estamos leyendo tu documento para llenar los datos de los firmantes</b>
              </div>
              <div className="firma-lector-barra" aria-hidden>
                <div style={{ width: `${Math.max(avance.pct, 4)}%` }} />
              </div>
              <div className="row small muted" style={{ gap: 8 }}>
                <span>{avance.etapa}</span>
                <span className="spacer" />
                <b>{avance.pct}%</b>
              </div>
              <span className="muted small">Mientras tanto puedes escribir los datos tú mismo si quieres.</span>
            </div>
          ) : personas && personas.length > 0 ? (
            <div className="firma-revisar" role="alert">
              <span className="firma-revisar-icono">⚠️</span>
              <div>
                <b>Revisa bien los datos antes de continuar.</b>
                <p className="small" style={{ margin: "4px 0 0" }}>
                  Encontramos {personas.length === 1 ? "1 persona" : `${personas.length} personas`} en el documento y
                  llenamos sus datos automáticamente, pero la lectura puede equivocarse. Confirma{" "}
                  <b>nombre, número de cédula, correo y WhatsApp</b> de cada firmante: a ellos les llega el enlace y el
                  código para firmar.
                </p>
              </div>
            </div>
          ) : personas && personas.length === 0 ? (
            <div className="firma-lector small">
              No encontramos firmantes en el documento. Escribe sus datos aquí abajo.
            </div>
          ) : null}
          {firmantes.map((f, i) => (
            <div key={i} className="firma-firmante" style={{ borderLeftColor: COLORES[i % COLORES.length] }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <b>Firmante {i + 1}</b>
                {f.numDoc && delDocumento.has(f.numDoc.replace(/\D/g, "")) && (
                  <span className="badge reciente" style={{ marginLeft: 8 }}>Del documento</span>
                )}
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
                  <input type="text" value={f.nombre} maxLength={120} onChange={(e) => cambiar(i, { nombre: e.target.value })} />
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
                  <input type="text" value={f.numDoc} maxLength={30} onChange={(e) => cambiar(i, { numDoc: e.target.value })} />
                </label>
                <label className="medio">
                  <span className="small">Correo</span>
                  <input type="email" value={f.email} maxLength={160} onChange={(e) => cambiar(i, { email: e.target.value })} />
                </label>
                <label className="medio">
                  <span className="small">WhatsApp</span>
                  <input type="tel" inputMode="numeric" value={f.telefono} maxLength={15} onChange={(e) => cambiar(i, { telefono: e.target.value })} />
                </label>
              </div>
            </div>
          ))}
          {firmantes.length < 10 && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setFirmantes((fs) => [...fs, siguiente ? desdePersona(siguiente) : vacio()])}
            >
              + Agregar otro firmante{siguiente ? ` (${siguiente.nombre})` : ""}
            </button>
          )}
        </div>
      )}

      {/* ---------- Paso 3: ubicar firmas ---------- */}
      {paso === 2 && doc && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Ubica la firma de cada uno</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Ya ubicamos cada firma en un espacio en blanco, encima del nombre de cada firmante. Si quieres cambiarla,
            elige un firmante y <b>toca el documento</b>, o arrastra el recuadro.
          </p>
          {ubicando && (
            <div className="firma-lector buscando small" role="status" style={{ marginBottom: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="firma-lector-lupa">📐</span>
                <span>Buscando el mejor espacio en blanco para cada firma…</span>
              </div>
              <div className="firma-lector-barra indeterminada" aria-hidden>
                <div />
              </div>
            </div>
          )}
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
            <input type="checkbox" checked={otpWhatsapp} onChange={(e) => setOtpWhatsapp(e.target.checked)} />
            <span>Enviar el código por <b>WhatsApp</b></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={otpCorreo} onChange={(e) => setOtpCorreo(e.target.checked)} />
            <span>Enviar el código por <b>correo</b></span>
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
                <span style={{ flex: 1 }}>
                  <b>{n.t}</b>
                  <span className="muted small" style={{ display: "block" }}>{n.d}</span>
                </span>
                <span className="firma-precio">
                  {cobro.gratis ? <s>{pesos(cobro.precios[n.k])}</s> : pesos(cobro.precios[n.k])}
                </span>
              </label>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Todos los niveles incluyen el código OTP. El precio es por documento, sin importar cuántos firmantes tenga.
          </p>
          {cobro.gratis ? (
            <div className="ok small" style={{ marginTop: 8 }}>
              {cobro.motivo === "admin"
                ? "Cuenta administradora: este envío no tiene costo."
                : "🎁 Tu primer documento es gratis, para que pruebes la firma electrónica."}
            </div>
          ) : (
            <div className="firma-total">
              <span>Total a pagar</span>
              <b>{pesos(cobro.precios[verificacion])}</b>
              <span className="muted small">
                Pagas con Bold (tarjeta, PSE, Nequi o Botón Bancolombia). Apenas se confirme el pago, enviamos los
                enlaces a los firmantes.
              </span>
            </div>
          )}
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
            {ocupado
              ? modo === "pdf" && archivo && /\.docx?$/i.test(archivo.name)
                ? "Convirtiendo el Word…"
                : "Preparando…"
              : "Continuar →"}
          </button>
        )}
        {(paso === 1 || paso === 2) && (
          <button type="button" className="btn" onClick={() => irA(paso + 1)}>
            Continuar →
          </button>
        )}
        {paso === 3 && (
          <button type="button" className="btn" disabled={enviando} onClick={enviarYa}>
            <Icon name="send" size={16} />{" "}
            {enviando
              ? cobro.gratis
                ? "Enviando…"
                : "Abriendo el pago…"
              : cobro.gratis
                ? "Enviar a firmar"
                : `Pagar ${pesos(cobro.precios[verificacion])} y enviar`}
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
