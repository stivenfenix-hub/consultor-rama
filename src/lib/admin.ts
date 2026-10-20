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

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { cases: true } },
    },
  });
}
