"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { PdfPaginas } from "@/components/pdf-paginas";

type Canales = { correo: string | null; whatsapp: string | null };
type Pos = { page: number; x: number; y: number; width: number; height: number } | null;
type Paso = "otp" | "leer" | "firmar" | "listo" | "rechazado";

const FUENTES = [
  { n: "Dancing Script", t: "Clásica" },
  { n: "Great Vibes", t: "Elegante" },
  { n: "Caveat", t: "Natural" },
];

async function post(url: string, body: unknown) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, estado: r.status, j: j as Record<string, unknown> | null };
  } catch {
    return { ok: false, estado: 0, j: { error: "Sin conexión. Revise su internet e intente de nuevo." } as Record<string, unknown> };
  }
}

export function PortalFirma({
  token,
  abogado,
  titulo,
  nombre,
  documento,
  canales,
  verificado,
  bloqueo,
  yaFirmo,
  completado,
  posicion,
  aceptacion,
}: {
  token: string;
  abogado: string;
  titulo: string;
  nombre: string;
  documento: string;
  canales: Canales;
  verificado: boolean;
  bloqueo: string | null;
  yaFirmo: boolean;
  completado: boolean;
  posicion: Pos;
  aceptacion: string;
}) {
  const api = `/api/firmar/${token}`;
  const [paso, setPaso] = useState<Paso>(yaFirmo ? "listo" : verificado ? "leer" : "otp");
  const [todos, setTodos] = useState(completado);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // OTP
  const [enviadoA, setEnviadoA] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [espera, setEspera] = useState(0);
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  // Firma
  const [modo, setModo] = useState<"dibujar" | "escribir">("dibujar");
  const [fuente, setFuente] = useState(FUENTES[0].n);
  const [texto, setTexto] = useState(nombre);
  const [acepta, setAcepta] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const lienzo = useRef<LienzoRef>(null);

  if (bloqueo && !yaFirmo) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 22 }}>{titulo}</h1>
        <p className="muted">{bloqueo}</p>
      </div>
    );
  }

  async function pedirCodigo(canal: "correo" | "whatsapp") {
    setError(null);
    setOcupado(true);
    const r = await post(`${api}/otp`, { canal });
    setOcupado(false);
    if (!r.ok) return setError(String(r.j?.error ?? "No pudimos enviar el código."));
    setEnviadoA(`${canal === "correo" ? "al correo" : "al"} ${String(r.j?.destino ?? "")}`);
    setCodigo("");
    setEspera(45);
  }

  async function verificar(c: string) {
    setError(null);
    setOcupado(true);
    const r = await post(`${api}/verificar`, { codigo: c });
    setOcupado(false);
    if (!r.ok) {
      setCodigo("");
      return setError(String(r.j?.error ?? "Código incorrecto."));
    }
    setPaso("leer");
    window.scrollTo({ top: 0 });
  }

  async function firmar() {
    setError(null);
    if (!acepta) return setError("Marque la casilla de aceptación para poder firmar.");
    let imagen: string | null = null;
    if (modo === "dibujar") {
      imagen = lienzo.current?.exportar() ?? null;
      if (!imagen) return setError("Dibuje su firma en el recuadro.");
    } else {
      if (texto.trim().length < 3) return setError("Escriba su nombre para la firma.");
      imagen = await firmaTipografica(texto.trim(), fuente);
    }
    setOcupado(true);
    const r = await post(`${api}/firmar`, { imagen, tipo: modo === "dibujar" ? "dibujada" : "tipografica", acepta: true });
    setOcupado(false);
    if (r.estado === 401) {
      setPaso("otp");
      setEnviadoA(null);
      return setError(String(r.j?.error ?? "Su sesión venció."));
    }
    if (!r.ok) return setError(String(r.j?.error ?? "No pudimos registrar su firma. Intente de nuevo."));
    setTodos(r.j?.completado === true);
    setPaso("listo");
    window.scrollTo({ top: 0 });
  }

  async function rechazar() {
    setError(null);
    if (motivo.trim().length < 3) return setError("Escriba el motivo.");
    setOcupado(true);
    const r = await post(`${api}/rechazar`, { motivo });
    setOcupado(false);
    if (!r.ok) return setError(String(r.j?.error ?? "No pudimos registrar su respuesta."));
    setPaso("rechazado");
  }

  const pasos: [Paso, string][] = [["otp", "Verificar"], ["leer", "Leer"], ["firmar", "Firmar"]];
  const indice = pasos.findIndex(([p]) => p === paso);

  return (
    <>
      {/* Fuentes de la firma tipográfica (solo en esta página). */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Dancing+Script:wght@600&family=Great+Vibes&display=swap"
      />

      {indice >= 0 && (
        <ol className="firma-pasos">
          {pasos.map(([p, t], i) => (
            <li key={p} className={i === indice ? "actual" : i < indice ? "hecho" : ""}>
              <span>{i < indice ? <Icon name="check" size={14} /> : i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
      )}

      {/* ---------- 1. Código ---------- */}
      {paso === "otp" && (
        <div className="card">
          <p className="muted small" style={{ margin: 0 }}>{abogado} le envió un documento para firmar</p>
          <h1 style={{ fontSize: 22, margin: "4px 0 10px" }}>{titulo}</h1>
          <div className="firmar-quien">
            <Icon name="users" size={18} />
            <div>
              <b>{nombre}</b>
              <div className="muted small">{documento}</div>
            </div>
          </div>

          {!enviadoA ? (
            <>
              <p>
                Para proteger su firma, primero confirmamos que es usted: le enviamos un <b>código de 6 dígitos</b>.
              </p>
              <div className="firmar-canales">
                {canales.correo && (
                  <button type="button" className="btn" disabled={ocupado} onClick={() => pedirCodigo("correo")}>
                    <Icon name="mail" size={16} /> Enviar al correo {canales.correo}
                  </button>
                )}
                {canales.whatsapp && (
                  <button type="button" className={`btn ${canales.correo ? "secondary" : ""}`} disabled={ocupado} onClick={() => pedirCodigo("whatsapp")}>
                    <Icon name="chat" size={16} /> Enviar al WhatsApp {canales.whatsapp}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p>
                Escriba el código que enviamos {enviadoA}. Vence en 10 minutos.
              </p>
              <input
                className="firmar-codigo"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={codigo}
                placeholder="000000"
                onChange={(e) => {
                  const c = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCodigo(c);
                  if (c.length === 6 && !ocupado) verificar(c);
                }}
              />
              <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
                <button type="button" className="btn" disabled={ocupado || codigo.length !== 6} onClick={() => verificar(codigo)}>
                  {ocupado ? "Verificando…" : "Verificar"}
                </button>
                <button type="button" className="btn secondary" disabled={ocupado || espera > 0} onClick={() => setEnviadoA(null)}>
                  {espera > 0 ? `Pedir otro en ${espera} s` : "Pedir otro código"}
                </button>
              </div>
            </>
          )}
          <p className="muted small" style={{ marginBottom: 0 }}>
            No comparta el código con nadie: equivale a su firma.
          </p>
        </div>
      )}

      {/* ---------- 2. Leer ---------- */}
      {paso === "leer" && (
        <>
          <div className="card">
            <h1 style={{ fontSize: 20, margin: 0 }}>{titulo}</h1>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Lea el documento completo. El recuadro morado muestra dónde quedará su firma.
            </p>
          </div>
          <div className="firmar-doc">
            <PdfPaginas
              src={`${api}/pdf?leer=1`}
              sobre={(pagina) =>
                posicion && posicion.page === pagina ? (
                  <div
                    className="firma-recuadro fijo"
                    style={{
                      left: `${posicion.x * 100}%`,
                      top: `${posicion.y * 100}%`,
                      width: `${posicion.width * 100}%`,
                      height: `${posicion.height * 100}%`,
                    }}
                  >
                    <span>Aquí va su firma</span>
                  </div>
                ) : null
              }
            />
          </div>
          <div className="firmar-barra">
            <button type="button" className="btn" onClick={() => { setError(null); setPaso("firmar"); window.scrollTo({ top: 0 }); }}>
              Ya lo leí: continuar a firmar →
            </button>
          </div>
        </>
      )}

      {/* ---------- 3. Firmar ---------- */}
      {paso === "firmar" && (
        <div className="card">
          <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Su firma</h1>
          <p className="muted small" style={{ marginTop: 0 }}>{nombre} · {documento}</p>
          <div className="firmar-tabs">
            <button type="button" className={modo === "dibujar" ? "sel" : ""} onClick={() => setModo("dibujar")}>
              <Icon name="firma" size={16} /> Dibujar
            </button>
            <button type="button" className={modo === "escribir" ? "sel" : ""} onClick={() => setModo("escribir")}>
              Aa Escribir
            </button>
          </div>

          {modo === "dibujar" ? (
            <Lienzo ref={lienzo} />
          ) : (
            <>
              <input type="text" value={texto} maxLength={60} onChange={(e) => setTexto(e.target.value)} placeholder="Su nombre" />
              <div className="firmar-fuentes">
                {FUENTES.map((f) => (
                  <button key={f.n} type="button" className={fuente === f.n ? "sel" : ""} onClick={() => setFuente(f.n)}>
                    <span style={{ fontFamily: `"${f.n}", cursive` }}>{texto.trim() || "Su nombre"}</span>
                    <small className="muted">{f.t}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          <label className="check firmar-acepta">
            <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
            <span>{aceptacion}</span>
          </label>

          {!rechazando ? (
            <>
              <button type="button" className="btn firmar-boton" disabled={ocupado} onClick={firmar}>
                <Icon name="firma" size={18} /> {ocupado ? "Firmando…" : "Firmar documento"}
              </button>
              <div className="row wrap" style={{ gap: 14, marginTop: 12, justifyContent: "center" }}>
                <button type="button" className="firmar-enlace" onClick={() => { setError(null); setPaso("leer"); }}>
                  ← Volver a leer
                </button>
                <button type="button" className="firmar-enlace" onClick={() => { setError(null); setRechazando(true); }}>
                  No voy a firmar
                </button>
              </div>
            </>
          ) : (
            <div className="firmar-rechazo">
              <b>¿Por qué no va a firmar?</b>
              <p className="muted small" style={{ margin: "2px 0 8px" }}>Su abogado recibe este mensaje y el documento queda sin efecto.</p>
              <textarea rows={3} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: mi número de cédula está mal escrito." />
              <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
                <button type="button" className="btn danger" disabled={ocupado} onClick={rechazar}>
                  {ocupado ? "Enviando…" : "Confirmar: no firmo"}
                </button>
                <button type="button" className="btn secondary" disabled={ocupado} onClick={() => { setError(null); setRechazando(false); }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- Final ---------- */}
      {paso === "listo" && (
        <div className="card" style={{ textAlign: "center" }}>
          <div className="firmar-ok">
            <Icon name="check" size={34} />
          </div>
          <h1 style={{ fontSize: 22, margin: "12px 0 6px" }}>¡Documento firmado!</h1>
          <p className="muted">
            Su firma de <b>«{titulo}»</b> quedó registrada con fecha, hora y la verificación de su identidad.
          </p>
          {todos ? (
            <>
              <p>Ya firmaron todos. Puede descargar el PDF sellado con su certificado.</p>
              <a className="btn" href={`${api}/pdf?tipo=firmado`}>
                <Icon name="download" size={16} /> Descargar documento firmado
              </a>
            </>
          ) : (
            <p className="muted small">
              Cuando firmen las demás personas, le llega el PDF sellado a su correo. También lo podrá descargar entrando
              de nuevo a este mismo enlace.
            </p>
          )}
        </div>
      )}
      {paso === "rechazado" && (
        <div className="card" style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 22 }}>Respuesta enviada</h1>
          <p className="muted">Le avisamos a {abogado} que no firmó el documento y por qué. Ya puede cerrar esta página.</p>
        </div>
      )}

      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
    </>
  );
}

// ---------- Lienzo para dibujar la firma ----------

type LienzoRef = { exportar: () => string | null };

function Lienzo({ ref }: { ref: React.Ref<LienzoRef> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const trazo = useRef<{ x: number; y: number } | null>(null);
  const tinta = useRef(0);
  const [vacio, setVacio] = useState(true);

  // El lienzo se dibuja a 2x-3x para que la firma quede nítida en el PDF.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.max(2, Math.min(window.devicePixelRatio || 1, 3));
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#14123a";
    ctx.lineWidth = 2.4;
  }, []);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const limpiar = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    tinta.current = 0;
    setVacio(true);
  };

  // Lo que usa el padre: la imagen PNG (fondo transparente) o null si no hay firma.
  useEffect(() => {
    const r = { exportar: () => (tinta.current > 40 && canvas.current ? recortar(canvas.current) : null) };
    if (typeof ref === "function") ref(r);
    else if (ref) (ref as React.RefObject<LienzoRef | null>).current = r;
  }, [ref]);

  return (
    <div className="firmar-lienzo">
      <canvas
        ref={canvas}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          trazo.current = punto(e);
          const ctx = e.currentTarget.getContext("2d");
          // Un toque también deja un punto.
          ctx?.beginPath();
          ctx?.arc(trazo.current.x, trazo.current.y, 1.2, 0, Math.PI * 2);
          ctx?.fill();
        }}
        onPointerMove={(e) => {
          const a = trazo.current;
          if (!a) return;
          const b = punto(e);
          const ctx = e.currentTarget.getContext("2d");
          if (!ctx) return;
          // Curva suave hasta el punto medio: el trazo no sale quebrado.
          const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(a.x, a.y, m.x, m.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          tinta.current += Math.hypot(b.x - a.x, b.y - a.y);
          trazo.current = b;
          if (vacio) setVacio(false);
        }}
        onPointerUp={() => (trazo.current = null)}
        onPointerCancel={() => (trazo.current = null)}
      />
      {vacio && <span className="firmar-lienzo-guia muted">Firme aquí con el dedo o el mouse</span>}
      <div className="firmar-lienzo-raya" />
      <button type="button" className="firmar-enlace firmar-borrar" onClick={limpiar}>
        Borrar
      </button>
    </div>
  );
}

/**
 * PNG solo con la parte dibujada (más un margen): así la firma llena su
 * recuadro en el documento en vez de quedar pequeña entre el espacio vacío.
 */
function recortar(c: HTMLCanvasElement): string {
  const ctx = c.getContext("2d");
  if (!ctx) return c.toDataURL("image/png");
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return c.toDataURL("image/png");
  const m = 12;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(width - 1, x1 + m);
  y1 = Math.min(height - 1, y1 + m);
  const r = document.createElement("canvas");
  r.width = x1 - x0 + 1;
  r.height = y1 - y0 + 1;
  r.getContext("2d")?.drawImage(c, x0, y0, r.width, r.height, 0, 0, r.width, r.height);
  return r.toDataURL("image/png");
}

/** Dibuja el nombre con la fuente elegida y devuelve el PNG. */
async function firmaTipografica(texto: string, fuente: string): Promise<string> {
  try {
    await document.fonts.load(`600 96px "${fuente}"`, texto);
  } catch {
    /* si la fuente no carga se usa la cursiva del dispositivo */
  }
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const fuenteCss = `600 96px "${fuente}", "Segoe Script", "Brush Script MT", cursive`;
  ctx.font = fuenteCss;
  const ancho = Math.ceil(ctx.measureText(texto).width) + 60;
  c.width = Math.min(Math.max(ancho, 300), 1800);
  c.height = 200;
  const ctx2 = c.getContext("2d")!;
  ctx2.font = fuenteCss;
  ctx2.fillStyle = "#14123a";
  ctx2.textBaseline = "middle";
  // Si el nombre es muy largo se encoge para que quepa.
  const escala = Math.min(1, (c.width - 60) / ctx2.measureText(texto).width);
  ctx2.translate(30, 104);
  ctx2.scale(escala, escala);
  ctx2.fillText(texto, 0, 0);
  return c.toDataURL("image/png");
}
