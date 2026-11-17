"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { numeroParecido } from "@/lib/firma-textos";

/**
 * Verificación de identidad del firmante (motor "estradox"):
 *   1. Fotos de la cédula por ambos lados -> se lee el número (OCR).
 *   2. Si el nivel es biométrico: selfie con prueba de vida (girar la cabeza y
 *      volver al centro) y comparación del rostro con la foto de la cédula.
 * Todo se calcula en el dispositivo con librerías libres (face-api y Tesseract,
 * desde CDN); al servidor llegan las fotos y el resultado como evidencia.
 */

const FACEAPI = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15";
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
/**
 * Distancia máxima entre rostros para considerarlos la misma persona. El
 * estándar de face-api es 0.6; se usa 0.65 (similitud mínima 35 %) porque la
 * foto de la cédula suele ser vieja, pequeña y con reflejos.
 */
const UMBRAL_ROSTRO = 0.65;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let faceApiPromesa: Promise<Any> | null = null;
function cargarFaceApi(): Promise<Any> {
  faceApiPromesa ??= (async () => {
    const fa = await import(/* webpackIgnore: true */ `${FACEAPI}/dist/face-api.esm.js`);
    const modelos = `${FACEAPI}/model`;
    await Promise.all([
      fa.nets.tinyFaceDetector.loadFromUri(modelos),
      fa.nets.faceLandmark68Net.loadFromUri(modelos),
      fa.nets.faceRecognitionNet.loadFromUri(modelos),
    ]);
    return fa;
  })().catch((e) => {
    faceApiPromesa = null;
    throw e;
  });
  return faceApiPromesa;
}

let tesseractPromesa: Promise<Any> | null = null;
function cargarTesseract(): Promise<Any> {
  tesseractPromesa ??= new Promise((ok, mal) => {
    const w = window as Any;
    if (w.Tesseract) return ok(w.Tesseract);
    const s = document.createElement("script");
    s.src = TESSERACT;
    s.onload = () => ok(w.Tesseract);
    s.onerror = () => {
      tesseractPromesa = null;
      mal(new Error("No se pudo cargar el lector de la cédula."));
    };
    document.head.appendChild(s);
  });
  return tesseractPromesa;
}

/** Reduce la foto (máx. 1600 px) y la pasa a JPEG para subirla liviana. */
async function prepararFoto(f: File): Promise<Blob> {
  const img = await createImageBitmap(f);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/jpeg", 0.88));
}

async function imagenDe(b: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(b);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Gris, más contraste y más grande: el lector acierta mucho más así. */
async function realzar(foto: Blob): Promise<Blob> {
  const img = await createImageBitmap(foto);
  const k = Math.max(1, 2000 / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  const ctx = c.getContext("2d")!;
  ctx.filter = "grayscale(1) contrast(1.6) brightness(1.05)";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
}

/**
 * Lee el texto de las fotos de la cédula y devuelve el número que más se
 * parece al del firmante (o el más largo que encuentre).
 */
async function leerNumero(fotos: Blob[], esperado: string): Promise<string | null> {
  const T = await cargarTesseract();
  const worker = await T.createWorker("eng");
  try {
    // 11 = texto suelto (una cédula no es un párrafo).
    await worker.setParameters({ tessedit_pageseg_mode: "11" });
    let mejor: string | null = null;
    for (const foto of fotos) {
      const { data } = await worker.recognize(await realzar(foto));
      const texto = String(data.text ?? "");
      // Números con puntos o espacios en medio: 1.042.093.184 -> 1042093184.
      const candidatos = (texto.match(/\d[\d.,\s]{3,18}\d/g) ?? [])
        .map((c) => c.replace(/\D/g, ""))
        .filter((c) => c.length >= 5);
      const bueno = candidatos.find((c) => numeroParecido(c, esperado));
      if (bueno) return bueno;
      // Último recurso: todos los dígitos de cada renglón juntos.
      for (const linea of texto.split(/\r?\n/)) {
        const d = linea.replace(/\D/g, "");
        if (numeroParecido(d, esperado)) return d;
      }
      for (const c of candidatos) if (!mejor || c.length > mejor.length) mejor = c;
    }
    return mejor;
  } finally {
    await worker.terminate();
  }
}

type Resultado = {
  numeroLeido: string | null;
  numeroCoincide: boolean;
  similitud: number | null;
  rostroCoincide: boolean | null;
};

/** Pantallas del paso de identidad, una cosa a la vez. */
type Pantalla = "autorizar" | "no-autoriza" | "frente" | "reverso" | "rostro" | "comprobando" | "resultado";

export function PasoIdentidad({
  api,
  nivel,
  numDoc,
  alTerminar,
}: {
  api: string;
  nivel: "cedula" | "biometrica";
  numDoc: string;
  alTerminar: () => void;
}) {
  const biometrica = nivel === "biometrica";
  const [pantalla, setPantalla] = useState<Pantalla>("autorizar");
  // Al repetir una sola foto se vuelve directo a comprobar.
  const [repitiendo, setRepitiendo] = useState(false);
  const [frente, setFrente] = useState<Blob | null>(null);
  const [reverso, setReverso] = useState<Blob | null>(null);
  const [selfie, setSelfie] = useState<{ foto: Blob; descriptor: Float32Array } | null>(null);
  const [vida, setVida] = useState({ parpadeo: false, giro: false });
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [intentos, setIntentos] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const digitos = numDoc.replace(/\D/g, "");

  // Pasos visibles para la barrita de avance.
  const pasos: { k: Pantalla; t: string }[] = [
    { k: "autorizar", t: "Autorizar" },
    { k: "frente", t: "Cédula frente" },
    { k: "reverso", t: "Cédula reverso" },
    ...(biometrica ? [{ k: "rostro" as Pantalla, t: "Rostro" }] : []),
    { k: "resultado", t: "Listo" },
  ];
  const indice = Math.max(
    0,
    pasos.findIndex((p) => p.k === (pantalla === "comprobando" ? "resultado" : pantalla === "no-autoriza" ? "autorizar" : pantalla)),
  );

  const ir = (p: Pantalla) => {
    setError(null);
    setPantalla(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const siguienteDe = (p: "frente" | "reverso" | "rostro"): Pantalla => {
    if (repitiendo) return "comprobando";
    if (p === "frente") return "reverso";
    if (p === "reverso") return biometrica ? "rostro" : "comprobando";
    return "comprobando";
  };

  // Al llegar a "comprobando" se revisa todo solo.
  useEffect(() => {
    if (pantalla !== "comprobando" || !frente || !reverso) return;
    let vivo = true;
    (async () => {
      setOcupado(true);
      setResultado(null);
      try {
        setEstado("Leyendo el número de su cédula…");
        const numeroLeido = await leerNumero([frente, reverso], digitos).catch(() => null);
        let similitud: number | null = null;
        let rostroCoincide: boolean | null = null;
        if (biometrica && selfie) {
          setEstado("Comparando su rostro con la foto de la cédula…");
          const fa = await cargarFaceApi();
          const img = await imagenDe(frente);
          const caras = await fa
            .detectAllFaces(img, new fa.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 }))
            .withFaceLandmarks()
            .withFaceDescriptors();
          // La foto de la cédula: el rostro más grande que se encuentre.
          const cara = caras.sort((a: Any, b: Any) => b.detection.box.area - a.detection.box.area)[0];
          if (cara) {
            const d = fa.euclideanDistance(cara.descriptor, selfie.descriptor);
            similitud = Math.max(0, Math.min(1, 1 - d));
            rostroCoincide = d <= UMBRAL_ROSTRO;
          }
        }
        if (!vivo) return;
        setIntentos((n) => n + 1);
        setResultado({ numeroLeido, numeroCoincide: numeroParecido(numeroLeido, digitos), similitud, rostroCoincide });
        setPantalla("resultado");
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No pudimos comprobar su identidad. Intente de nuevo.");
      } finally {
        if (vivo) {
          setEstado(null);
          setOcupado(false);
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [pantalla, frente, reverso, selfie, biometrica, digitos]);

  async function enviar() {
    if (!frente || !reverso || !resultado) return;
    setError(null);
    setOcupado(true);
    setEstado("Guardando la verificación…");
    try {
      const fd = new FormData();
      fd.set("consiente", "1");
      fd.set("frente", frente, "cedula-frente.jpg");
      fd.set("reverso", reverso, "cedula-reverso.jpg");
      if (selfie) fd.set("selfie", selfie.foto, "selfie.jpg");
      fd.set("resultado", JSON.stringify({ ...resultado, vida: biometrica ? vida : null, intentos: Math.max(intentos, 1) }));
      const r = await fetch(`${api}/identidad`, { method: "POST", body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? "No pudimos guardar la verificación.");
      alTerminar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar la verificación.");
    } finally {
      setEstado(null);
      setOcupado(false);
    }
  }

  const numeroOk = !!resultado?.numeroCoincide;
  const rostroOk = !biometrica || (!!resultado?.rostroCoincide && vida.giro);
  const todoCoincide = !!resultado && numeroOk && rostroOk;

  return (
    <div className="card identidad-paso">
      <div className="identidad-avance">
        <span>
          Paso {indice + 1} de {pasos.length}
        </span>
        <div className="identidad-avance-barra">
          <div style={{ width: `${((indice + 1) / pasos.length) * 100}%` }} />
        </div>
      </div>

      {/* ---------- 1. Autorización ---------- */}
      {pantalla === "autorizar" && (
        <>
          <div className="identidad-icono">
            <Icon name="shield" size={30} />
          </div>
          <h1 className="identidad-titulo">Vamos a confirmar que es usted</h1>
          <p className="identidad-texto">
            Le vamos a pedir una foto de su cédula por los dos lados
            {biometrica ? " y una foto de su cara" : ""}. Solo toma un minuto.
          </p>
          <div className="identidad-legal">
            ¿Autoriza a Estradox a usar las fotos de su cédula{biometrica ? " y de su rostro" : ""} solo para confirmar
            su identidad en este documento y guardarlas como prueba de su firma? (Ley 1581 de 2012). Son datos sensibles:
            usted decide si los entrega, pero sin ellos no puede firmar este documento.
          </div>
          <div className="identidad-decision">
            <button type="button" className="btn identidad-si" onClick={() => ir("frente")}>
              <Icon name="check" size={20} /> Sí, autorizo
            </button>
            <button type="button" className="btn secondary identidad-no" onClick={() => ir("no-autoriza")}>
              No
            </button>
          </div>
        </>
      )}

      {pantalla === "no-autoriza" && (
        <>
          <h1 className="identidad-titulo">Sin autorización no podemos seguir</h1>
          <p className="identidad-texto">
            Su abogado pidió confirmar su identidad para este documento. Si no desea entregar las fotos, comuníquese con
            él para buscar otra forma de firmar.
          </p>
          <div className="identidad-decision">
            <button type="button" className="btn identidad-si" onClick={() => ir("autorizar")}>
              ← Volver
            </button>
          </div>
        </>
      )}

      {/* ---------- 2 y 3. Cédula ---------- */}
      {pantalla === "frente" && (
        <FotoConCamara
          titulo="Foto del frente de su cédula"
          ayuda="Ponga el lado de la foto y el número dentro del recuadro."
          alListo={(b) => {
            setFrente(b);
            ir(siguienteDe("frente"));
          }}
        />
      )}
      {pantalla === "reverso" && (
        <FotoConCamara
          titulo="Ahora la parte de atrás"
          ayuda="Voltee la cédula y póngala dentro del recuadro."
          alListo={(b) => {
            setReverso(b);
            ir(siguienteDe("reverso"));
          }}
        />
      )}

      {/* ---------- 4. Rostro ---------- */}
      {pantalla === "rostro" && (
        <>
          <h1 className="identidad-titulo">Ahora su cara</h1>
          <p className="identidad-texto">Mire a la cámara y siga la instrucción que aparece en la pantalla.</p>
          <Camara
            alTerminar={(s, v) => {
              setSelfie(s);
              setVida(v);
              ir(siguienteDe("rostro"));
            }}
          />
        </>
      )}

      {/* ---------- Revisión ---------- */}
      {pantalla === "comprobando" && (
        <div className="identidad-comprobando">
          <div className="identidad-cargando" />
          <h1 className="identidad-titulo">Revisando…</h1>
          <p className="identidad-texto">{estado ?? "Un momento, por favor."}</p>
          {error && (
            <>
              <div className="error" style={{ marginTop: 12 }}>{error}</div>
              <button type="button" className="btn firmar-boton" style={{ marginTop: 12 }} onClick={() => { setPantalla("resultado"); setTimeout(() => setPantalla("comprobando"), 0); }}>
                Intentar de nuevo
              </button>
            </>
          )}
        </div>
      )}

      {pantalla === "resultado" && resultado && (
        <>
          <div className={`identidad-icono ${todoCoincide ? "ok" : "mal"}`}>
            <Icon name={todoCoincide ? "check" : "alert"} size={30} />
          </div>
          <h1 className="identidad-titulo">{todoCoincide ? "Identidad verificada" : "Casi listo"}</h1>
          {!todoCoincide && (
            <ul className="identidad-lista">
              <li className={numeroOk ? "ok" : "mal"}>
                {numeroOk ? "✓ Leímos el número de su cédula." : "✗ No logramos leer bien el número de su cédula."}
              </li>
              {biometrica && (
                <li className={rostroOk ? "ok" : "mal"}>
                  {resultado.rostroCoincide === null
                    ? "✗ No encontramos la foto de la cara en su cédula."
                    : rostroOk
                      ? "✓ Su cara coincide con la de la cédula."
                      : "✗ Su cara no coincide lo suficiente con la cédula."}
                </li>
              )}
            </ul>
          )}

          {todoCoincide ? (
            <SigueSolo segundos={5} ocupado={ocupado} alSeguir={enviar} />
          ) : (
            <div className="identidad-reintentos">
              {(!numeroOk || (biometrica && resultado.rostroCoincide === null)) && (
                <button type="button" className="btn firmar-boton" onClick={() => { setRepitiendo(true); ir("frente"); }}>
                  📸 Tomar otra vez la foto del frente
                </button>
              )}
              {biometrica && !rostroOk && resultado.rostroCoincide !== null && (
                <button type="button" className="btn firmar-boton" onClick={() => { setRepitiendo(true); ir("rostro"); }}>
                  🙂 Repetir la foto de su cara
                </button>
              )}
              <p className="muted small" style={{ textAlign: "center", margin: "6px 0 0" }}>
                Consejo: buena luz, sin reflejos y la cédula bien cerca de la cámara.
              </p>
              {intentos >= 2 && (
                <button type="button" className="firmar-enlace" style={{ display: "block", margin: "12px auto 0" }} disabled={ocupado} onClick={enviar}>
                  Continuar así (su abogado verá que la verificación no fue concluyente)
                </button>
              )}
            </div>
          )}
          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
        </>
      )}
    </div>
  );
}

/**
 * Foto de la cédula con la cámara (la de atrás en el celular), con un recuadro
 * del tamaño de la cédula. Se recorta solo ese recuadro. Si no hay cámara, se
 * puede subir una foto.
 */
function FotoConCamara({ titulo, ayuda, alListo }: { titulo: string; ayuda: string; alListo: (b: Blob) => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [lista, setLista] = useState(false);
  const [foto, setFoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apagar = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLista(false);
  };

  async function encender() {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play().catch(() => {});
      setLista(true);
      caja.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      setError("No pudimos abrir la cámara. Permita el acceso a la cámara, o suba una foto de su cédula.");
    }
  }

  useEffect(() => {
    encender();
    return apagar;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { if (foto) URL.revokeObjectURL(foto.url); }, [foto]);

  // Recorta del video exactamente lo que se ve dentro del recuadro.
  async function tomar() {
    const v = video.current;
    const c0 = caja.current?.querySelector(".identidad-cam") as HTMLElement | null;
    const marco = caja.current?.querySelector(".identidad-marco") as HTMLElement | null;
    if (!v || !c0 || !marco || !v.videoWidth) return;
    const cw = c0.clientWidth;
    const ch = c0.clientHeight;
    const escala = Math.max(cw / v.videoWidth, ch / v.videoHeight);
    const offX = (cw - v.videoWidth * escala) / 2;
    const offY = (ch - v.videoHeight * escala) / 2;
    const rc = c0.getBoundingClientRect();
    const rm = marco.getBoundingClientRect();
    const sx = Math.max(0, (rm.left - rc.left - offX) / escala);
    const sy = Math.max(0, (rm.top - rc.top - offY) / escala);
    const sw = Math.min(v.videoWidth - sx, rm.width / escala);
    const sh = Math.min(v.videoHeight - sy, rm.height / escala);
    const c = document.createElement("canvas");
    c.width = Math.round(sw);
    c.height = Math.round(sh);
    c.getContext("2d")!.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const blob: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), "image/jpeg", 0.92));
    setFoto({ blob, url: URL.createObjectURL(blob) });
    apagar();
  }

  return (
    <div ref={caja}>
      <h1 className="identidad-titulo">{titulo}</h1>
      <p className="identidad-texto">{ayuda}</p>

      {foto ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="identidad-vista" src={foto.url} alt={titulo} />
          <p className="identidad-texto" style={{ marginTop: 10 }}>¿Se ven bien el número y la foto?</p>
          <div className="identidad-decision">
            <button type="button" className="btn identidad-si" onClick={() => alListo(foto.blob)}>
              <Icon name="check" size={20} /> Sí, usar esta foto
            </button>
            <button type="button" className="btn secondary identidad-no" onClick={() => { setFoto(null); encender(); }}>
              Tomar otra
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="identidad-cam">
            <video ref={video} playsInline muted />
            <div className="identidad-marco" />
            {!lista && !error && <div className="identidad-instruccion">Abriendo la cámara…</div>}
          </div>
          {lista && (
            <button type="button" className="btn firmar-boton" style={{ marginTop: 12 }} onClick={tomar}>
              📸 Tomar foto
            </button>
          )}
          {error && <div className="error small" style={{ marginTop: 10 }}>{error}</div>}
          <label className="identidad-subir">
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const b = await prepararFoto(f);
                apagar();
                setFoto({ blob: b, url: URL.createObjectURL(b) });
              }}
            />
            ¿No le funciona la cámara? <u>Suba una foto</u>
          </label>
        </>
      )}
    </div>
  );
}

/**
 * Cámara frontal con prueba de vida: girar la cabeza hacia un lado y volver al
 * centro. La instrucción va encima del video, debajo del óvalo, para que la
 * persona no tenga que bajar a leer.
 */
function Camara({ alTerminar }: { alTerminar: (s: { foto: Blob; descriptor: Float32Array }, v: { parpadeo: boolean; giro: boolean }) => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [activa, setActiva] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detener = useRef<() => void>(() => {});

  useEffect(() => {
    iniciar();
    return () => detener.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function iniciar() {
    setError(null);
    setAviso("Preparando la cámara…");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false });
    } catch {
      setAviso(null);
      return setError("No pudimos abrir la cámara. Permita el acceso a la cámara en su navegador e intente de nuevo.");
    }
    const v = video.current!;
    v.srcObject = stream;
    await v.play().catch(() => {});
    setActiva(true);
    // La cámara completa a la vista (en el celular queda centrada en la pantalla).
    caja.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    let fa: Any;
    try {
      setAviso("Cargando el reconocimiento facial…");
      fa = await cargarFaceApi();
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setActiva(false);
      setAviso(null);
      return setError("No pudimos cargar el reconocimiento facial. Revise su conexión e intente de nuevo.");
    }

    let vivo = true;
    detener.current = () => {
      vivo = false;
      stream.getTracks().forEach((t) => t.stop());
    };
    const opciones = new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    let girado = false;
    let listo = false;

    while (vivo) {
      // Las tareas de face-api son "thenables", no promesas: Promise.resolve las vuelve promesas.
      const r = await Promise.resolve(fa.detectSingleFace(v, opciones).withFaceLandmarks()).catch(() => null);
      if (!vivo) break;
      if (!r) {
        setAviso("Ponga su rostro dentro del óvalo");
      } else {
        const p = r.landmarks.positions as { x: number; y: number }[];
        // Giro: posición de la nariz entre los dos bordes de la mandíbula (0.5 = de frente).
        const giro = (p[30].x - p[0].x) / Math.max(1, p[16].x - p[0].x);
        const deFrente = giro > 0.4 && giro < 0.6;

        if (!listo) {
          if (giro < 0.35 || giro > 0.65) {
            girado = true;
            setAviso("Bien. Ahora vuelva a mirar de frente");
          } else if (girado && deFrente) {
            listo = true;
            setHecho(true);
          } else {
            setAviso("Gire la cabeza hacia un lado");
          }
        }

        if (listo) {
          // Prueba superada: se toma la selfie con el rostro de frente.
          setAviso("¡Muy bien! Quédese quieto un momento…");
          if (deFrente) {
            const c = document.createElement("canvas");
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            c.getContext("2d")!.drawImage(v, 0, 0);
            const cara = await fa.detectSingleFace(c, opciones).withFaceLandmarks().withFaceDescriptor();
            if (cara) {
              const foto: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), "image/jpeg", 0.9));
              detener.current();
              setActiva(false);
              alTerminar({ foto, descriptor: cara.descriptor }, { parpadeo: false, giro: true });
              return;
            }
          }
        }
      }
      await new Promise((ok) => setTimeout(ok, 30));
    }
  }

  return (
    <div className="identidad-camara" ref={caja}>
      <div className={`identidad-video ${activa ? "activa" : ""}`}>
        <video ref={video} playsInline muted />
        {activa && <div className={`identidad-ovalo ${hecho ? "hecho" : ""}`} />}
        {activa && aviso && <div className={`identidad-instruccion ${hecho ? "hecho" : ""}`}>{aviso}</div>}
        {!activa && (
          <button type="button" className="btn" onClick={iniciar}>
            <Icon name="eye" size={16} /> Abrir la cámara
          </button>
        )}
      </div>
      {error && <div className="error small" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

/** Cuenta regresiva: sigue sola al siguiente paso (o al tocar el botón). */
function SigueSolo({ segundos, ocupado, alSeguir }: { segundos: number; ocupado: boolean; alSeguir: () => void }) {
  const [quedan, setQuedan] = useState(segundos);
  const hecho = useRef(false);
  const seguir = useRef(alSeguir);
  seguir.current = alSeguir;
  useEffect(() => {
    if (quedan <= 0) {
      if (!hecho.current) {
        hecho.current = true;
        seguir.current();
      }
      return;
    }
    const t = setTimeout(() => setQuedan((q) => q - 1), 1000);
    return () => clearTimeout(t);
  }, [quedan]);
  return (
    <>
      <div className="identidad-cuenta" aria-hidden>
        <div style={{ animationDuration: `${segundos}s` }} />
      </div>
      <button
        type="button"
        className="btn firmar-boton"
        disabled={ocupado}
        onClick={() => {
          // Si el guardado automático falló, el botón permite reintentar.
          hecho.current = true;
          alSeguir();
        }}
      >
        {ocupado ? "Guardando…" : quedan > 0 ? `Continuar → (${quedan})` : "Continuar →"}
      </button>
    </>
  );
}
