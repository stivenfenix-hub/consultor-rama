import { NextRequest, NextResponse } from "next/server";
import { auditar, origenDe, registrarFirma, sha256 } from "@/lib/firmas";
import { accesoFirmante, bloqueo } from "@/lib/firma-portal";
import { guardarArchivo } from "@/lib/firma-storage";
import { avisarAbogado } from "@/lib/firma-envios";
import { ACEPTACION } from "@/lib/firma-textos";
import { sellarSiCompleto } from "@/services/signature-engine";

// Recibe la firma (PNG dibujado o tipográfico) y la aceptación legal.
// Si era la última firma, sella el documento.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await accesoFirmante(token);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.estado });
  const { firmante: f, doc } = a;
  const motivo = bloqueo(doc, f);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  if (!a.verificado) {
    return NextResponse.json(
      { error: "Su sesión venció. Confirme su identidad con un código nuevo." },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  if (body?.acepta !== true) {
    return NextResponse.json({ error: "Debe aceptar la declaración legal para firmar." }, { status: 400 });
  }
  const tipo = body?.tipo === "tipografica" ? "tipografica" : "dibujada";
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body?.imagen ?? ""));
  const imagen = m ? Buffer.from(m[1], "base64") : null;
  if (!imagen || imagen.length < 200 || imagen.length > 800_000 || !imagen.subarray(0, 8).equals(PNG)) {
    return NextResponse.json({ error: "La firma no llegó bien. Hágala de nuevo." }, { status: 400 });
  }

  const clave = await guardarArchivo(`${doc.id}/firma-${f.id}.png`, imagen);
  if (!(await registrarFirma(f.id, clave, tipo))) {
    return NextResponse.json({ error: "Este documento ya no se puede firmar." }, { status: 409 });
  }
  await auditar(doc.id, "SIGNED", {
    firmanteId: f.id,
    ...origenDe(req.headers),
    metadata: { tipoFirma: tipo, firmaSha256: sha256(imagen), aceptacion: ACEPTACION },
  });
  await avisarAbogado(doc, `✍️ ${f.nombre} firmó`, `«${doc.titulo}»`);

  // Si era la última firma se genera el PDF sellado. Si el sellado falla, la
  // firma ya quedó registrada y se reintenta al abrir el documento.
  let completado = false;
  try {
    completado = await sellarSiCompleto(doc.id);
  } catch {
    completado = false;
  }
  return NextResponse.json({ ok: true, completado });
}
