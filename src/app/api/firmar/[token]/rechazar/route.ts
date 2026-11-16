import { NextRequest, NextResponse } from "next/server";
import { auditar, origenDe, registrarRechazo } from "@/lib/firmas";
import { accesoFirmante, bloqueo } from "@/lib/firma-portal";
import { avisarAbogado } from "@/lib/firma-envios";

// El firmante decide no firmar (con su motivo). El documento queda rechazado.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await accesoFirmante(token);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.estado });
  const { firmante: f, doc } = a;
  const motivo = bloqueo(doc, f);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  if (!a.verificado) {
    return NextResponse.json({ error: "Primero confirme su identidad con el código." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const texto = String(body?.motivo ?? "").trim().slice(0, 500);
  if (texto.length < 3) {
    return NextResponse.json({ error: "Cuéntele a su abogado por qué no firma." }, { status: 400 });
  }
  if (!(await registrarRechazo(f.id, texto))) {
    return NextResponse.json({ error: "Este documento ya no se puede rechazar." }, { status: 409 });
  }
  await auditar(doc.id, "REJECTED", { firmanteId: f.id, ...origenDe(req.headers), metadata: { motivo: texto } });
  await avisarAbogado(doc, `⚠️ ${f.nombre} no firmó`, `«${doc.titulo}»: ${texto.slice(0, 120)}`);
  return NextResponse.json({ ok: true });
}
