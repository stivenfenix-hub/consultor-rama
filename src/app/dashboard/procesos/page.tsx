import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icon";
import { AddCaseForm } from "./add-case-form";
import { MAX_RADICADOS_POR_ENVIO } from "@/lib/validation";

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

  const todos = await prisma.case.findMany({
    where: { userId: user.id },
    orderBy: [{ lastActuacionDate: "desc" }, { createdAt: "desc" }],
  });

  // Con novedades = tiene actuaciones nuevas que el abogado no ha visto.
  const { filtro: f } = await searchParams;
  const filtro: Filtro = f === "novedades" || f === "aldia" ? f : "todos";
  const conNovedades = todos.filter((c) => c.unseenCount > 0);
  const alDia = todos.filter((c) => c.unseenCount === 0);
  const cases = filtro === "novedades" ? conNovedades : filtro === "aldia" ? alDia : todos;

  // Un radicado puede estar en dos sistemas de la Rama (p. ej. Justicia XXI y
  // SIUGJ): son dos registros del mismo proceso y en la lista se veían iguales.
  const porRadicado = new Map<string, typeof todos>();
  for (const c of todos) porRadicado.set(c.radicado, [...(porRadicado.get(c.radicado) ?? []), c]);
  const registro = (c: (typeof todos)[number]) => {
    const grupo = porRadicado.get(c.radicado) ?? [];
    if (grupo.length < 2) return null;
    const sistema = c.ubicacion?.replace(/^Software:\s*/i, "").trim();
    // El grupo viene ordenado por última actuación: el primero es el más al día.
    return {
      etiqueta: sistema || `Registro ${grupo.indexOf(c) + 1}`,
      masReciente: grupo[0].id === c.id,
      total: grupo.length,
    };
  };
  const pestanas: { key: Filtro; label: string; n: number }[] = [
    { key: "todos", label: "Todos", n: todos.length },
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
      {todos.length > 0 && cases.length === 0 && (
        <p className="muted">
          {filtro === "novedades"
            ? "No hay novedades sin revisar. Todos tus procesos están al día."
            : "Todos tus procesos tienen novedades por revisar."}
        </p>
      )}

      {cases.map((c) => {
        const reg = registro(c);
        return (
        <Link
          key={c.id}
          href={`/dashboard/procesos/${c.id}`}
          className="case"
        >
          <div className="row wrap">
            <span className="radicado">{c.radicado}</span>
            {c.unseenCount > 0 && (
              <span className="badge new">{c.unseenCount} nuevas</span>
            )}
            {c.esPrivado && <span className="badge">privado</span>}
            {reg && <span className="badge">{reg.etiqueta}</span>}
            {reg?.masReciente && <span className="badge reciente">más reciente</span>}
            <div className="spacer" />
            <span className="muted small">
              Últ. actuación: {fmt(c.lastActuacionDate)}
            </span>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {c.despacho ?? "Despacho no disponible"}
            {c.departamento ? ` · ${c.departamento}` : ""}
          </div>
          {reg && (
            <div className="muted small" style={{ marginTop: 4 }}>
              Este radicado tiene {reg.total} registros en la Rama (uno por sistema).
            </div>
          )}
          {c.lastError &&
            (c.lastError.startsWith("Proceso privado") ? (
              <div className="muted small" style={{ marginTop: 4 }}>🔒 {c.lastError}</div>
            ) : (
              <div className="error small">Error última sync: {c.lastError}</div>
            ))}
        </Link>
        );
      })}
    </div>
  );
}
