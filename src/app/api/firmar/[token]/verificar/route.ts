import { NextRequest, NextResponse } from "next/server";
import {
  OTP_MAX_INTENTOS,
  auditar,
  cookieFirma,
  hashOtp,
  origenDe,
  otpFallido,
  otpVerificado,
  sellarSesion,
} from "@/lib/firmas";
import { accesoFirmante, bloqueo } from "@/lib/firma-portal";

// Comprueba el código OTP. Si es correcto deja una cookie de 30 minutos que
// habilita leer y firmar el documento desde este navegador.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await accesoFirmante(token);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.estado });
  const { firmante: f, doc } = a;
  const motivo = bloqueo(doc, f);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const codigo = String(body?.codigo ?? "").replace(/\D/g, "");
  const origen = origenDe(req.headers);
  if (!f.otpHash || !f.otpExpira || new Date(f.otpExpira) < new Date()) {
    return NextResponse.json({ error: "El código venció. Pida uno nuevo." }, { status: 400 });
  }
  if (f.otpIntentos >= OTP_MAX_INTENTOS) {
    return NextResponse.json({ error: "Demasiados intentos. Pida un código nuevo." }, { status: 429 });
  }
  if (codigo.length !== 6 || hashOtp(f.id, codigo) !== f.otpHash) {
    const n = await otpFallido(f.id);
    await auditar(doc.id, "OTP_FAILED", { firmanteId: f.id, ...origen, metadata: { intento: n } });
    const quedan = OTP_MAX_INTENTOS - n;
    return NextResponse.json(
      {
        error:
          quedan > 0
            ? `Código incorrecto. Le quedan ${quedan} intento(s).`
            : "Demasiados intentos. Pida un código nuevo.",
      },
      { status: 400 },
    );
  }

  await otpVerificado(f.id);
  await auditar(doc.id, "OTP_VERIFIED", { firmanteId: f.id, ...origen });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieFirma(f.id), sellarSesion(f.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 60,
  });
  return res;
}
