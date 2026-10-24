import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { body, jsonError, perfil, str, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// GET -> { user, suscripcion }. Funciona aunque el acceso esté vencido.
export async function GET(req: NextRequest) {
  return withMobileUser(req, async (user) => NextResponse.json(await perfil(user)), {
    allowExpired: true,
  });
}

// DELETE { password } -> { ok }. Elimina la cuenta y todos sus datos
// (procesos, actuaciones, documentos, sesiones). Requisito de Google Play.
export async function DELETE(req: NextRequest) {
  return withMobileUser(
    req,
    async (user) => {
      if (user.role === "admin") {
        return jsonError("La cuenta administradora no se puede eliminar desde la app.", 403);
      }
      const password = str((await body(req)).password);
      const ok = !!user.passwordHash && (await bcrypt.compare(password, user.passwordHash));
      if (!ok) return jsonError("La contraseña no es correcta.", 400);
      await prisma.user.delete({ where: { id: user.id } });
      return NextResponse.json({ ok: "Tu cuenta y todos tus datos fueron eliminados." });
    },
    { allowExpired: true },
  );
}
