import { NextRequest, NextResponse } from "next/server";
import { getSuscripcion, pagosDeUsuario, verificarPagosPendientes } from "@/lib/subscription";
import { withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// GET -> { suscripcion, pagos }. Solo consulta: la app no vende planes
// (Google Play no permite cobrar contenido digital fuera de su sistema de pagos).
export async function GET(req: NextRequest) {
  return withMobileUser(
    req,
    async (user) => {
      await verificarPagosPendientes(user.id);
      const [sub, pagos] = await Promise.all([getSuscripcion(user.id), pagosDeUsuario(user.id)]);
      return NextResponse.json({
        suscripcion: {
          estado: sub.estado,
          accesoHasta: sub.accesoHasta,
          diasRestantes: sub.diasRestantes,
        },
        pagos: pagos.map((p) => ({
          id: p.id,
          amount: p.amount,
          status: p.status,
          meses: p.meses,
          fecha: p.paidAt ?? p.createdAt,
        })),
      });
    },
    { allowExpired: true },
  );
}
