import { NextRequest } from "next/server";
import { jsonError, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// "Actualizar todos" se retiró: solo queda el botón de cada proceso (la cola nocturna
// sigue actualizando todos). Se deja la ruta para que las apps viejas reciban un aviso claro.
export async function POST(req: NextRequest) {
  return withMobileUser(req, async () =>
    jsonError("Actualizar todos ya no está disponible. Actualiza cada proceso desde su detalle; cada noche revisamos todos automáticamente.", 410),
  );
}
