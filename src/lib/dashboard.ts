import "server-only";
import { prisma } from "./db";

export type Slice = { label: string; value: number };

export interface DashboardStats {
  totalProcesos: number;
  nuevosEsteMes: number;
  actuacionesEsteMes: number;
  sinVer: number;
  buckets: { b0_6: number; b6_12: number; b12: number; sin: number };
  porClase: Slice[];
  porDepartamento: Slice[];
}

function groupCount(
  items: (string | null | undefined)[],
  fallback = "Sin dato",
): Slice[] {
  const map = new Map<string, number>();
  for (const raw of items) {
    const key = (raw ?? "").trim() || fallback;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const cases = await prisma.case.findMany({
    where: { userId },
    select: {
      departamento: true,
      claseProceso: true,
      lastActuacionDate: true,
      createdAt: true,
      unseenCount: true,
    },
  });

  const totalProcesos = cases.length;
  const nuevosEsteMes = cases.filter((c) => c.createdAt >= startOfMonth).length;
  const sinVer = cases.reduce((n, c) => n + c.unseenCount, 0);

  const actuacionesEsteMes = await prisma.actuacion.count({
    where: { case: { userId }, fechaActuacion: { gte: startOfMonth } },
  });

  const buckets = { b0_6: 0, b6_12: 0, b12: 0, sin: 0 };
  const MES = 1000 * 60 * 60 * 24 * 30.44;
  for (const c of cases) {
    if (!c.lastActuacionDate) {
      buckets.sin++;
      continue;
    }
    const meses = (now.getTime() - c.lastActuacionDate.getTime()) / MES;
    if (meses <= 6) buckets.b0_6++;
    else if (meses <= 12) buckets.b6_12++;
    else buckets.b12++;
  }

  return {
    totalProcesos,
    nuevosEsteMes,
    actuacionesEsteMes,
    sinVer,
    buckets,
    porClase: groupCount(cases.map((c) => c.claseProceso)),
    porDepartamento: groupCount(cases.map((c) => c.departamento)),
  };
}
