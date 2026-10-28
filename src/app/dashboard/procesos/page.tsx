import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icon";
import { AddCaseForm } from "./add-case-form";
import { MAX_RADICADOS_POR_ENVIO } from "@/lib/validation";
import { cargasPendientesDeVer, reintentosDelUsuario } from "@/lib/sync";
import { CargaAviso } from "./carga-aviso";

// Lo que gana el abogado al agregar sus procesos (pantalla vacía).
const BENEFICIOS: { icon: "scale" | "download" | "bell" | "eye"; titulo: string; texto: string }[] = [
  {
    icon: "scale",
    titulo: "Agrega todos los que quieras",
    texto: "Sin límite de procesos. Pega varios radicados a la vez y listo.",
  },
  {
    icon: "download",
    titulo: "Ve y descarga los documentos",
    texto: "Autos, providencias y demás documentos de las actuaciones, en PDF, sin entrar a la Rama.",
  },
  {
    icon: "bell",
    titulo: "Te avisamos de cada novedad",
    texto: "Revisamos tus procesos cada noche y te notificamos cuando hay actuaciones nuevas.",
  },
  {
    icon: "eye",
    titulo: "Todo en una sola pantalla",
    texto: "Estado, despacho, partes, actuaciones y grabaciones de cada expediente.",
  },
];

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Bogota",
  });
}

type Filtro = "todos" | "novedades" | "aldia";

export default async function ProcesosPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [todos, cargas, reintentos] = await Promise.all([
    prisma.case.findMany({
      where: { userId: user.id },
      orderBy: [{ lastActuacionDate: "desc" }, { createdAt: "desc" }],
    }),
    cargasPendientesDeVer(user.id).catch(() => []),
    reintentosDelUsuario(user.id).catch(() => []),
  ]);

  // Un radicado puede estar en varios sistemas de la Rama (p. ej. Justicia XXI
  // y SIUGJ): son registros del mismo proceso y se muestran en una sola tarjeta.
  // Adentro se ve de qué sistema sale la información y se cambia entre ellos.
  const porRadicado = new Map<string, typeof todos>();
  for (const c of todos) porRadicado.set(c.radicado, [...(porRadicado.get(c.radicado) ?? []), c]);
  // Ya vienen ordenados por última actuación: el primero es el más al día.
  const grupos = [...porRadicado.values()].map((g) => ({
    principal: g[0],
    registros: g.length,
    nuevas: g.reduce((n, c) => n + c.unseenCount, 0),
    privado: g.every((c) => c.esPrivado),
  }));

  // Con novedades = tiene actuaciones nuevas que el abogado no ha visto.
  const { filtro: f } = await searchParams;
  const filtro: Filtro = f === "novedades" || f === "aldia" ? f : "todos";
  const conNovedades = grupos.filter((g) => g.nuevas > 0);
  const alDia = grupos.filter((g) => g.nuevas === 0);
  const lista = filtro === "novedades" ? conNovedades : filtro === "aldia" ? alDia : grupos;
  const pestanas: { key: Filtro; label: string; n: number }[] = [
    { key: "todos", label: "Todos", n: grupos.length },
    { key: "novedades", label: "Con novedades", n: conNovedades.length },
    { key: "aldia", label: "Al día", n: alDia.length },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Procesos</h1>
      </div>

      <div className="card">
        <h2>Agregar proceso por radicado</h2>
        <AddCaseForm max={MAX_RADICADOS_POR_ENVIO} />
      </div>

      {(cargas.length > 0 || reintentos.length > 0) && (
        <CargaAviso cargas={cargas} reintentos={reintentos} esAdmin={user.role === "admin"} />
      )}

      {todos.length > 0 && (
        <nav className="tabbar tabbar-3">
          {pestanas.map((p) => (
            <Link
              key={p.key}
              href={p.key === "todos" ? "/dashboard/procesos" : `/dashboard/procesos?filtro=${p.key}`}
              className={`tab ${filtro === p.key ? "active" : ""}`}
              scroll={false}
            >
              {p.label}
              <span className="tab-count">{p.n}</span>
            </Link>
          ))}
        </nav>
      )}

      {todos.length === 0 && (
        <div className="card empty-benefits">
          <h2>Agrega tus procesos y empieza a ahorrar tiempo</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Escribe arriba el radicado de 23 dígitos. Esto es lo que obtienes:
          </p>
          <div className="benefit-grid">
            {BENEFICIOS.map((b) => (
              <div key={b.titulo} className="benefit">
                <span className="benefit-icon"><Icon name={b.icon} size={20} /></span>
                <div>
                  <div className="benefit-title">{b.titulo}</div>
                  <div className="muted small">{b.texto}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {todos.length > 0 && lista.length === 0 && (
        <p className="muted">
          {filtro === "novedades"
            ? "No hay novedades sin revisar. Todos tus procesos están al día."
            : "Todos tus procesos tienen novedades por revisar."}
        </p>
      )}

      {lista.map(({ principal: c, registros, nuevas, privado }) => (
        <Link key={c.id} href={`/dashboard/procesos/${c.id}`} className="case">
          <div className="row wrap">
            <span className="radicado">{c.radicado}</span>
            {nuevas > 0 && <span className="badge new">{nuevas} nuevas</span>}
            {privado && <span className="badge">privado</span>}
            {registros > 1 && <span className="badge reciente">{registros} fuentes</span>}
            <div className="spacer" />
            <span className="muted small">Últ. actuación: {fmt(c.lastActuacionDate)}</span>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {c.despacho ?? "Despacho no disponible"}
            {c.departamento ? ` · ${c.departamento}` : ""}
          </div>
          {c.lastError &&
            (c.lastError.startsWith("Proceso privado") ? (
              <div className="muted small" style={{ marginTop: 4 }}>🔒 {c.lastError}</div>
            ) : (
              <div className="error small">Error última sync: {c.lastError}</div>
            ))}
        </Link>
      ))}
    </div>
  );
}
