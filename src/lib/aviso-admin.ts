import { prisma } from "@/lib/db";
import { sendPushToUsers } from "@/lib/push";
import { motivosSospecha } from "@/lib/sospechoso";

/**
 * Avisa al root (usuarios con rol admin) de cada registro nuevo: notificación
 * push y aviso en la app. Útil mientras arrancan las campañas y hay pocos
 * registros; nunca debe romper el registro, así que los errores solo se anotan.
 */
export async function avisarNuevoUsuario(userId: string, via: "correo" | "Google" | "la app Android") {
  try {
    const [user, admins] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true, name: true },
      }),
      prisma.user.findMany({ where: { role: "admin" }, select: { id: true } }),
    ]);
    if (!user || admins.length === 0) return;
    const nombre =
      [user.firstName, user.lastName].filter(Boolean).join(" ") || user.name || "Sin nombre";
    const motivos = motivosSospecha(user);
    await sendPushToUsers(
      admins.map((a) => a.id),
      {
        title: motivos.length > 0 ? "⚠️ Registro sospechoso" : "🎉 Nuevo usuario",
        body:
          `${nombre} (${user.email}) se registró con ${via}.` +
          (motivos.length > 0 ? ` Parece falso: ${motivos.join("; ")}. Revísalo y elimínalo si lo apruebas.` : ""),
        url: "/dashboard/admin/usuarios",
        tag: `nuevo-usuario-${userId}`,
      },
    );
  } catch (e) {
    console.error("[aviso-admin] nuevo usuario", e);
  }
}
