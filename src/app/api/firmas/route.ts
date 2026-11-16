import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getCurrentUser } from "@/lib/auth";
import { getSuscripcion, tieneAcceso } from "@/lib/subscription";
import { auditar, crearDocumento, origenDe, sha256 } from "@/lib/firmas";
import { guardarArchivo } from "@/lib/firma-storage";
import { camposFaltantes, plantillaPorId, renderizarPlantilla } from "@/services/signature-engine";

// Paso 1 del asistente: crea el borrador a partir de un PDF subido o de una
// plantilla legal. Va por ruta (no por server action) porque las server
// actions limitan el cuerpo a 1 MB y un PDF suele pesar más.
export const dynamic = "force-dynamic";

const MAX_MB = 15;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!tieneAcceso(await getSuscripcion(user.id))) {
    return NextResponse.json({ error: "Tu acceso venció. Renueva tu plan." }, { status: 402 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });

  const radicado = String(form.get("radicado") ?? "").replace(/\D/g, "");
  if (radicado && radicado.length !== 23) {
    return NextResponse.json({ error: "El radicado debe tener 23 dígitos (o déjalo vacío)." }, { status: 400 });
  }

  let pdf: Uint8Array;
  let titulo = String(form.get("titulo") ?? "").trim().slice(0, 160);
  let sugeridas: unknown[] = [];
  let origen: Record<string, unknown>;

  const plantillaId = String(form.get("plantilla") ?? "");
  if (plantillaId) {
    const plantilla = plantillaPorId(plantillaId);
    if (!plantilla) return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 400 });
    let valores: Record<string, string> = {};
    try {
      const v = JSON.parse(String(form.get("valores") ?? "{}"));
      for (const c of plantilla.campos) valores[c.clave] = String(v?.[c.clave] ?? "").slice(0, 1500);
    } catch {
      valores = {};
    }
    const faltan = camposFaltantes(plantilla, valores);
    if (faltan.length) return NextResponse.json({ error: `Falta llenar: ${faltan.join(", ")}.` }, { status: 400 });
    const r = await renderizarPlantilla(plantilla, valores);
    pdf = r.pdf;
    titulo ||= r.titulo;
    sugeridas = r.firmas;
    origen = { origen: "plantilla", plantilla: plantilla.id };
  } else {
    const archivo = form.get("archivo");
    if (!(archivo instanceof File) || archivo.size === 0) {
      return NextResponse.json({ error: "Sube un PDF o elige una plantilla." }, { status: 400 });
    }
    if (archivo.size > MAX_MB * 1024 * 1024) {
      return NextResponse.json({ error: `El PDF pesa más de ${MAX_MB} MB.` }, { status: 413 });
    }
    pdf = new Uint8Array(await archivo.arrayBuffer());
    if (Buffer.from(pdf.subarray(0, 5)).toString("latin1") !== "%PDF-") {
      return NextResponse.json({ error: "El archivo no es un PDF." }, { status: 400 });
    }
    titulo ||= archivo.name.replace(/\.pdf$/i, "").slice(0, 160);
    origen = { origen: "pdf", archivo: archivo.name.slice(0, 200), bytes: archivo.size };
  }
  if (!titulo) return NextResponse.json({ error: "Ponle un título al documento." }, { status: 400 });

  // Debe poder abrirse y estamparse después (un PDF protegido con clave no sirve).
  let paginas: number;
  try {
    const doc = await PDFDocument.load(pdf);
    paginas = doc.getPageCount();
  } catch {
    return NextResponse.json(
      { error: "No pudimos abrir ese PDF. Si está protegido con contraseña, súbelo sin protección." },
      { status: 400 },
    );
  }
  if (paginas < 1 || paginas > 200) {
    return NextResponse.json({ error: "El PDF debe tener entre 1 y 200 páginas." }, { status: 400 });
  }

  const id = randomUUID();
  const hash = sha256(pdf);
  const clave = await guardarArchivo(`${id}/original.pdf`, pdf);
  await crearDocumento({ id, userId: user.id, titulo, radicado: radicado || null, paginas, originalUrl: clave, originalSha256: hash });
  await auditar(id, "CREATED", { ...origenDe(req.headers), metadata: { ...origen, sha256: hash, paginas } });

  return NextResponse.json({ id, titulo, paginas, sha256: hash, sugeridas });
}
