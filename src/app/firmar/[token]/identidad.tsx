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
  const [consiente, setConsiente] = useState(false);
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

  const listo = consiente && frente && reverso && (!biometrica || selfie);

  async function comprobar() {
    if (!frente || !reverso) return;
    setError(null);
    setOcupado(true);
    setResultado(null);
    try {
      setEstado("Leyendo el número de la cédula…");
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
      setIntentos((n) => n + 1);
      setResultado({
        numeroLeido,
        numeroCoincide: numeroParecido(numeroLeido, digitos),
        similitud,
        rostroCoincide,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos comprobar su identidad. Intente de nuevo.");
    } finally {
      setEstado(null);
      setOcupado(false);
    }
  }

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

  const todoCoincide =
    resultado && resultado.numeroCoincide && (!biometrica || (resultado.rostroCoincide && vida.giro));

  return (
    <div className="card">
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Verifique su identidad</h1>
      <p className="muted small" style={{ marginTop: 0 }}>
        Su abogado pidió confirmar que es usted quien firma
        {biometrica ? ": fotos de su cédula y una selfie." : ": fotos de su cédula."}
      </p>

      <label className="check firmar-acepta" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={consiente} onChange={(e) => setConsiente(e.target.checked)} />
        <span>
          Autorizo a Estradox a tratar las fotos de mi documento de identidad
          {biometrica ? " y mis datos biométricos (rostro)" : ""} con la única finalidad de verificar mi identidad en
          este documento y conservarlas como evidencia de la firma (Ley 1581 de 2012). Entiendo que son datos sensibles
          y que no estoy obligado a suministrarlos, pero sin ellos no puedo firmar este documento.
        </span>
      </label>

      <div className="identidad-fotos">
        <FotoCedula titulo="Cédula: frente" foto={frente} alElegir={async (f) => { setResultado(null); setFrente(await prepararFoto(f)); }} />
        <FotoCedula titulo="Cédula: reverso" foto={reverso} alElegir={async (f) => { setResultado(null); setReverso(await prepararFoto(f)); }} />
      </div>
      <p className="muted small" style={{ margin: "6px 0 0" }}>
        Ponga la cédula sobre una superficie oscura, con buena luz y sin reflejos. Que se lean bien el número y la foto.
      </p>

      {biometrica && (
        <div style={{ marginTop: 16 }}>
          <b>Selfie con prueba de vida</b>
          {selfie ? (
            <div className="identidad-selfie-lista">
              <img src={URL.createObjectURL(selfie.foto)} alt="Su selfie" />
              <div>
                <div className="ok small">✓ Prueba de vida superada</div>
                <button type="button" className="firmar-enlace" onClick={() => { setSelfie(null); setResultado(null); setVida({ parpadeo: false, giro: false }); }}>
                  Repetir la selfie
                </button>
              </div>
            </div>
          ) : (
            <Camara
              alTerminar={(s, v) => {
                setSelfie(s);
                setVida(v);
                setResultado(null);
              }}
            />
          )}
        </div>
      )}

      {resultado && (
        <div className={`firma-veredicto ${todoCoincide ? "si" : "no"}`}>
          <div className="firma-veredicto-icon">
            <Icon name={todoCoincide ? "check" : "alert"} size={22} />
          </div>
          <div className="small">
            <b>{todoCoincide ? "Identidad verificada" : "No pudimos confirmar todo"}</b>
            <div>
              {resultado.numeroCoincide
                ? "✓ El número de la cédula coincide."
                : "✗ No logramos leer el número de su cédula. Tome la foto más cerca y con más luz."}
            </div>
            {biometrica && (
              <div>
                {resultado.rostroCoincide === null
                  ? "✗ No encontramos el rostro en la foto de la cédula."
                  : resultado.rostroCoincide
                    ? `✓ Su rostro coincide con la cédula (${Math.round((resultado.similitud ?? 0) * 100)} %).`
                    : `✗ El rostro no coincide lo suficiente con la cédula (${Math.round((resultado.similitud ?? 0) * 100)} %).`}
              </div>
            )}
          </div>
        </div>
      )}

      {estado && <div className="muted small" style={{ marginTop: 12 }}>⏳ {estado}</div>}
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 14 }}>
        {!resultado ? (
          <button type="button" className="btn firmar-boton" disabled={!listo || ocupado} onClick={comprobar}>
            <Icon name="shield" size={18} /> {ocupado ? "Comprobando…" : "Verificar mi identidad"}
          </button>
        ) : todoCoincide ? (
          <button type="button" className="btn firmar-boton" disabled={ocupado} onClick={enviar}>
            Continuar a leer el documento →
          </button>
        ) : (
          <>
            <button type="button" className="btn firmar-boton" disabled={ocupado} onClick={() => { setResultado(null); setFrente(null); setReverso(null); }}>
              Tomar las fotos de nuevo
            </button>
            {intentos >= 2 && (
              <button type="button" className="firmar-enlace" style={{ display: "block", margin: "12px auto 0" }} disabled={ocupado} onClick={enviar}>
                Continuar así (su abogado verá que la verificación no fue concluyente)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FotoCedula({ titulo, foto, alElegir }: { titulo: string; foto: Blob | null; alElegir: (f: File) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!foto) return setUrl(null);
    const u = URL.createObjectURL(foto);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [foto]);
  return (
    <label className={`identidad-foto ${foto ? "lista" : ""}`}>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) alElegir(f);
          e.target.value = "";
        }}
      />
      {url ? <img src={url} alt={titulo} /> : <Icon name="card" size={28} />}
      <b className="small">{titulo}</b>
      <span className="muted small">{foto ? "Toque para cambiarla" : "Toque para tomar la foto"}</span>
    </label>
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

  useEffect(() => () => detener.current(), []);

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
