import "server-only";
import { prisma } from "./db";
import { radicadosSoloEstados } from "./estados";

// Los 2 primeros dígitos del radicado son el código DANE del departamento (como lo escribe la Rama).
const DEPARTAMENTOS: Record<string, string> = {
  "05": "ANTIOQUIA", "08": "ATLÁNTICO", "11": "BOGOTÁ", "13": "BOLÍVAR", "15": "BOYACÁ",
  "17": "CALDAS", "18": "CAQUETÁ", "19": "CAUCA", "20": "CESAR", "23": "CÓRDOBA",
  "25": "CUNDINAMARCA", "27": "CHOCÓ", "41": "HUILA", "44": "LA GUAJIRA", "47": "MAGDALENA",
  "50": "META", "52": "NARIÑO", "54": "NORTE DE SANTANDER", "63": "QUINDÍO", "66": "RISARALDA",
  "68": "SANTANDER", "70": "SUCRE", "73": "TOLIMA", "76": "VALLE DEL CAUCA", "81": "ARAUCA",
  "85": "CASANARE", "86": "PUTUMAYO", "88": "SAN ANDRÉS", "91": "AMAZONAS", "94": "GUAINÍA",
  "95": "GUAVIARE", "97": "VAUPÉS", "99": "VICHADA",
};
function departamentoDeRadicado(radicado: string): string | null {
  return DEPARTAMENTOS[radicado.slice(0, 2)] ?? null;
}

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

  const registros = await prisma.case.findMany({
    where: { userId },
    select: {
      radicado: true,
      departamento: true,
      claseProceso: true,
      lastActuacionDate: true,
      createdAt: true,
      unseenCount: true,
    },
  });

  // Un radicado puede estar en varios sistemas de la Rama (SIUGJ, Justicia
  // XXI...): para el abogado es un solo proceso, así que se cuenta una vez.
  type Reg = (typeof registros)[number];
  const porRadicado = new Map<string, Reg>();
  for (const r of registros) {
    const p = porRadicado.get(r.radicado);
    if (!p) {
      porRadicado.set(r.radicado, { ...r });
      continue;
    }
    p.departamento ??= r.departamento;
    p.claseProceso ??= r.claseProceso;
    if (r.lastActuacionDate && (!p.lastActuacionDate || r.lastActuacionDate > p.lastActuacionDate)) {
      p.lastActuacionDate = r.lastActuacionDate;
    }
    if (r.createdAt < p.createdAt) p.createdAt = r.createdAt;
    p.unseenCount += r.unseenCount;
  }
  const cases = [...porRadicado.values()];

  // Procesos activos: los de la Rama más los que solo están en estados
  // electrónicos (un radicado que está en ambos cuenta una vez, como en el plan).
  const soloEstados = await radicadosSoloEstados(userId).catch(() => [] as string[]);
  const totalProcesos = cases.length + soloEstados.length;
  const nuevosEsteMes = cases.filter((c) => c.createdAt >= startOfMonth).length;
  const sinVer = cases.reduce((n, c) => n + c.unseenCount, 0);

  const actuacionesEsteMes = await prisma.actuacion.count({
    where: { case: { userId }, fechaActuacion: { gte: startOfMonth } },
  });

  // Último estado electrónico de cada radicado: si es más reciente, esa es su última actuación.
  const ultimoEstado = new Map(
    (
      await prisma
        .$queryRawUnsafe<{ radicado: string; f: Date | null }[]>(
          `SELECT h.radicado, max(p.fecha) AS f
           FROM "EstadoHallazgo" h JOIN "EstadoPublicacion" p ON p.id = h."publicacionId"
           WHERE h."userId" = $1 GROUP BY h.radicado`,
          userId,
        )
        .catch(() => [])
    ).map((r) => [r.radicado, r.f ? new Date(r.f) : null] as const),
  );
  const masReciente = (a: Date | null, b: Date | null | undefined) => (!a ? b ?? null : !b ? a : a > b ? a : b);
  const fechas = [
    ...cases.map((c) => masReciente(c.lastActuacionDate, ultimoEstado.get(c.radicado))),
    ...soloEstados.map((r) => ultimoEstado.get(r) ?? null),
  ];

  const buckets = { b0_6: 0, b6_12: 0, b12: 0, sin: 0 };
  const MES = 1000 * 60 * 60 * 24 * 30.44;
  for (const f of fechas) {
    if (!f) {
      buckets.sin++;
      continue;
    }
    const meses = (now.getTime() - f.getTime()) / MES;
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
    // Los que solo están en estados no tienen clase en la Rama: van en su propia categoría.
    porClase: groupCount([
      ...cases.map((c) => c.claseProceso),
      ...soloEstados.map(() => "Publicaciones Procesales"),
    ]),
    // Los que solo están en estados también suman: el departamento sale del código del radicado.
    porDepartamento: groupCount([
      ...cases.map((c) => c.departamento ?? departamentoDeRadicado(c.radicado)),
      ...soloEstados.map(departamentoDeRadicado),
    ]),
  };
}
