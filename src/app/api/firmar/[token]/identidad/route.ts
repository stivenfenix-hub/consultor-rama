import { NextRequest, NextResponse } from "next/server";
import {
  auditar,
  guardarIdentidad,
  origenDe,
  sha256,
  type ResultadoIdentidad,
} from "@/lib/firmas";
import { accesoFirmante, bloqueo } from "@/lib/firma-portal";
import { guardarArchivo } from "@/lib/firma-storage";
import { verificarConProveedor } from "@/lib/identidad-proveedor";

// Paso de identidad del portal: recibe las fotos de la cédula (y la selfie si
// el nivel es biométrico) más lo que midió el dispositivo, y lo guarda como
// evidencia. Solo después del código OTP.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];

async function imagen(form: FormData, campo: string): Promise<{ datos: Buffer; ext: string } | null> {
  const f = form.get(campo);
  if (!(f instanceof File) || f.size === 0 || f.size > MAX_BYTES) return null;
  const datos = Buffer.from(await f.arrayBuffer());
  if (JPEG.every((b, i) => datos[i] === b)) return { datos, ext: "jpg" };
  if (PNG.every((b, i) => datos[i] === b)) return { datos, ext: "png" };
  return null;
}

const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const num01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : null);

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await accesoFirmante(token);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.estado });
  const { firmante: f, doc } = a;
  const motivo = bloqueo(doc, f);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  if (!a.verificado) {
    return NextResponse.json({ error: "Su sesión venció. Confirme su identidad con un código nuevo." }, { status: 401 });
  }
  if (doc.verificacion === "otp") {
    return NextResponse.json({ error: "Este documento no requiere verificación de identidad." }, { status: 400 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  if (form.get("consiente") !== "1") {
    return NextResponse.json({ error: "Debe autorizar el uso de sus datos para verificar su identidad." }, { status: 400 });
  }
  const frente = await imagen(form, "frente");
  const reverso = await imagen(form, "reverso");
  if (!frente || !reverso) {
    return NextResponse.json({ error: "Tome las fotos de su cédula por ambos lados (JPG o PNG, máximo 5 MB)." }, { status: 400 });
  }
  const biometrica = doc.verificacion === "biometrica";
  const selfie = biometrica ? await imagen(form, "selfie") : null;
  if (biometrica && !selfie) {
    return NextResponse.json({ error: "Falta la selfie de la prueba de vida." }, { status: 400 });
  }

  // Lo que midió el dispositivo del firmante (lectura del número, rostro y prueba de vida).
  let m: Record<string, unknown> = {};
  try {
    m = JSON.parse(String(form.get("resultado") ?? "{}"));
  } catch {
    m = {};
  }
  const vida = m.vida && typeof m.vida === "object" ? (m.vida as Record<string, unknown>) : null;
  const numeroLeido = typeof m.numeroLeido === "string" ? m.numeroLeido.replace(/\D/g, "").slice(0, 15) || null : null;
  const digitos = f.numDoc.replace(/\D/g, "");
  // El servidor vuelve a comparar el número leído con el del firmante.
  const numeroCoincide = numeroLeido ? numeroLeido.includes(digitos) && digitos.length >= 5 : false;
  let resultado: ResultadoIdentidad = {
    nivel: doc.verificacion,
    estado: "no_concluyente",
    motor: "estradox",
    numeroLeido,
    numeroCoincide,
    similitud: biometrica ? num01(m.similitud) : null,
    rostroCoincide: biometrica ? bool(m.rostroCoincide) : null,
    vida: biometrica && vida ? { parpadeo: vida.parpadeo === true, giro: vida.giro === true } : null,
    intentos: typeof m.intentos === "number" ? Math.min(Math.max(Math.round(m.intentos), 1), 20) : 1,
    huellas: {
      cedulaFrente: sha256(frente.datos),
      cedulaReverso: sha256(reverso.datos),
      ...(selfie ? { selfie: sha256(selfie.datos) } : {}),
    },
  };

  // Si hay un proveedor externo contratado, su veredicto reemplaza al del dispositivo.
  try {
    const p = await verificarConProveedor({
      numDoc: f.numDoc,
      tipoDoc: f.tipoDoc,
      frente: frente.datos,
      reverso: reverso.datos,
      selfie: selfie?.datos ?? null,
    });
    if (p) resultado = { ...resultado, ...p, nivel: resultado.nivel, intentos: resultado.intentos, huellas: resultado.huellas, numeroLeido };
  } catch (e) {
    console.error("[firma] proveedor de identidad", e);
  }

  resultado.estado =
    resultado.numeroCoincide === true &&
    (!biometrica || (resultado.rostroCoincide === true && resultado.vida?.parpadeo === true && resultado.vida?.giro === true))
      ? "verificada"
      : "no_concluyente";

  const base = `${doc.id}/`;
  const claveFrente = await guardarArchivo(`${base}cedula-frente-${f.id}.${frente.ext}`, frente.datos);
  const claveReverso = await guardarArchivo(`${base}cedula-reverso-${f.id}.${reverso.ext}`, reverso.datos);
  const claveSelfie = selfie ? await guardarArchivo(`${base}selfie-${f.id}.${selfie.ext}`, selfie.datos) : null;
  await guardarIdentidad(f.id, { frente: claveFrente, reverso: claveReverso, selfie: claveSelfie, resultado });

  await auditar(doc.id, resultado.estado === "verificada" ? "IDENTITY_VERIFIED" : "IDENTITY_INCONCLUSIVE", {
    firmanteId: f.id,
    ...origenDe(req.headers),
    metadata: {
      nivel: resultado.nivel,
      motor: resultado.motor,
      numeroCoincide: resultado.numeroCoincide,
      similitud: resultado.similitud,
      rostroCoincide: resultado.rostroCoincide,
      vida: resultado.vida,
      intentos: resultado.intentos,
      huellas: resultado.huellas,
      autorizacionDatosSensibles: true,
    },
  });
  return NextResponse.json({ ok: true, estado: resultado.estado, numeroCoincide: resultado.numeroCoincide });
}
