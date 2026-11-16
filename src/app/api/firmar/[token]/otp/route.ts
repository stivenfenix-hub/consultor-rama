import { NextRequest, NextResponse } from "next/server";
import { OTP_MINUTOS, auditar, guardarOtp, hashOtp, nuevoOtp, origenDe } from "@/lib/firmas";
import { accesoFirmante, bloqueo } from "@/lib/firma-portal";
import { enviarOtp } from "@/lib/firma-envios";

// Envía el código de 6 dígitos al correo o al WhatsApp del firmante.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await accesoFirmante(token);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.estado });
  const { firmante: f, doc } = a;
  const motivo = bloqueo(doc, f);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const canal = body?.canal === "whatsapp" ? "whatsapp" : "correo";
  const permitido = canal === "whatsapp" ? doc.otpWhatsapp && !!f.telefono : doc.otpCorreo && !!f.email;
  if (!permitido) {
    return NextResponse.json({ error: "Ese medio no está disponible para este documento." }, { status: 400 });
  }

  // Un código cada 45 segundos como máximo.
  if (f.otpExpira) {
    const enviado = new Date(f.otpExpira).getTime() - OTP_MINUTOS * 60_000;
    const falta = Math.ceil((enviado + 45_000 - Date.now()) / 1000);
    if (falta > 0) {
      return NextResponse.json({ error: `Espere ${falta} segundos para pedir otro código.` }, { status: 429 });
    }
  }

  const codigo = nuevoOtp();
  await guardarOtp(f.id, hashOtp(f.id, codigo));
  let destino: string;
  try {
    destino = await enviarOtp(doc, f, codigo, canal);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No pudimos enviar el código." },
      { status: 502 },
    );
  }
  await auditar(doc.id, "OTP_SENT", { firmanteId: f.id, ...origenDe(req.headers), metadata: { canal, destino } });
  return NextResponse.json({ ok: true, destino, minutos: OTP_MINUTOS });
}
