import "server-only";
import { prisma } from "./db";

export async function getAdminStats() {
  const now = new Date();
  const hace30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalUsuarios,
    verificados,
    activos30,
    nuevosMes,
    totalProcesos,
    totalActuaciones,
    admins,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { emailVerified: { not: null } } }),
    prisma.user.count({ where: { lastLoginAt: { gte: hace30 } } }),
    prisma.user.count({ where: { createdAt: { gte: inicioMes } } }),
    prisma.case.count(),
    prisma.actuacion.count(),
    prisma.user.count({ where: { role: "admin" } }),
  ]);

  return {
    totalUsuarios,
    verificados,
    activos30,
    nuevosMes,
    totalProcesos,
    totalActuaciones,
    admins,
  };
}

/** Usuarios registrados (sin contar admins) y cuántos entraron este mes, para el portal socios. */
export async function usuariosRegistrados() {
  const now = new Date();
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
  const [total, nuevosMes] = await Promise.all([
    prisma.user.count({ where: { role: { not: "admin" } } }),
    prisma.user.count({ where: { role: { not: "admin" }, createdAt: { gte: inicioMes } } }),
  ]);
  return { total, nuevosMes };
}

/** Usuarios para la tabla del root, por páginas y con búsqueda opcional (nombre o correo). */
export async function listUsers(opts: { pagina?: number; porPagina?: number; q?: string } = {}) {
  const porPagina = opts.porPagina ?? 20;
  const pagina = Math.max(1, opts.pagina ?? 1);
  const q = opts.q?.trim();
  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        role: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { cases: true } },
      },
    }),
  ]);
  return { users, total, pagina, paginas: Math.max(1, Math.ceil(total / porPagina)) };
}

/** Datos livianos de todos (para los totales y los sospechosos). */
export async function resumenUsuarios() {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      role: true,
      emailVerified: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
}
