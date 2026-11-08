import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icon";
import { AddCaseForm } from "./add-case-form";
import { MAX_RADICADOS_POR_ENVIO } from "@/lib/validation";
import { cargasPendientesDeVer, reintentosDelUsuario } from "@/lib/sync";
import { CargaAviso } from "./carga-aviso";
import { avisoProceso } from "@/lib/aviso-rama";
import { estadosActivo, hallazgosSinVer, soloEnEstados } from "@/lib/estados";
import { QuitarDeEstados } from "../estados/quitar-estado";
import { usoProcesos } from "@/lib/subscription";
import { Paginador, POR_PAGINA, paginaDe } from "@/components/paginador";

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
  /** pe: página de la lista "En estados electrónicos" (de a 20). */
  searchParams: Promise<{ filtro?: string; pagina?: string; pe?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [todos, cargas, reintentos, estados, uso] = await Promise.all([
    // Solo los campos de la tarjeta (sin partes, sujetos, etc.); se muestran de a 20.
    prisma.case.findMany({
      where: { userId: user.id },
      orderBy: [{ lastActuacionDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: {
        id: true,
        radicado: true,
        unseenCount: true,
        esPrivado: true,
        lastActuacionDate: true,
        despacho: true,
        departamento: true,
        lastError: true,
      },
    }),
    cargasPendientesDeVer(user.id).catch(() => []),
    reintentosDelUsuario(user.id).catch(() => []),
    estadosActivo(user.id)
      .then(async (a) =>
        a ? { sinVer: await hallazgosSinVer(user.id), solo: await soloEnEstados(user.id) } : null,
      )
      .catch(() => null),
    usoProcesos(user.id).catch(() => null),
  ]);
  const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const beneficios = uso?.limitado
    ? BENEFICIOS.map((b) =>
        b.icon === "scale"
          ? {
              ...b,
              // Sin cifras ni precio: solo se avisa cuando pasa de los incluidos.
              titulo: "Agrega tus procesos",
              texto: "Pega varios radicados a la vez y listo.",
            }
          : b,
      )
    : BENEFICIOS;

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
  const { filtro: f, pagina: pg, pe } = await searchParams;
  const pagE = paginaDe(pe, estados?.solo.length ?? 0);
  const filtro: Filtro = f === "novedades" || f === "aldia" ? f : "todos";
  const conNovedades = grupos.filter((g) => g.nuevas > 0);
  const alDia = grupos.filter((g) => g.nuevas === 0);
  const filtrados = filtro === "novedades" ? conNovedades : filtro === "aldia" ? alDia : grupos;
  const pag = paginaDe(pg, filtrados.length);
  const lista = filtrados.slice(pag.desde, pag.desde + POR_PAGINA);
  const hrefPagina = (p: number) => {
    const s = new URLSearchParams();
    if (filtro !== "todos") s.set("filtro", filtro);
    if (p > 1) s.set("pagina", String(p));
    const t = s.toString();
    return `/dashboard/procesos${t ? `?${t}` : ""}`;
  };
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

      {/* Las caídas de la Rama no se le muestran al abogado (solo al root, en Panel admin). */}

      <div className="card">
        <h2>Agregar proceso por radicado</h2>
        <AddCaseForm max={MAX_RADICADOS_POR_ENVIO} />
        {/* Barra de carga y resultado, justo debajo del botón Agregar. */}
        {(cargas.length > 0 || reintentos.length > 0) && (
          <div style={{ marginTop: 14, marginBottom: -14 }}>
            <CargaAviso cargas={cargas} reintentos={reintentos} esAdmin={user.role === "admin"} estados={!!estados} />
          </div>
        )}
        {/* Plan con procesos incluidos (usuarios desde el 3 nov 2026). */}
        {/* Solo se avisa cuando ya pasó de los incluidos. */}
        {uso?.limitado && uso.adicionales > 0 && (
          <div className="muted small" style={{ marginTop: 10 }}>
            📋 Tu plan incluye <b>{uso.incluidos} procesos</b> · llevas <b>{uso.total}</b>. Tienes{" "}
            <b>{uso.adicionales} adicional(es)</b>: +{pesos(uso.valorMes)} al mes que se suman a tu próximo pago.{" "}
            <Link href="/dashboard/suscripcion">Ver detalle</Link>
          </div>
        )}
      </div>

      {estados && (
        <Link href="/dashboard/estados" className="case">
          <div className="row wrap">
            <b>📋 Estados electrónicos</b>
            {estados.sinVer > 0 && <span className="badge new">{estados.sinVer} nuevos</span>}
            <div className="spacer" />
            <span className="muted small">Ver dónde salieron tus procesos →</span>
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Buscamos tus radicados en los estados que publica cada juzgado, aunque no estén en la Consulta Nacional.
          </div>
        </Link>
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
            {beneficios.map((b) => (
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
            {privado && <span className="badge" title="La Rama no publica sus actuaciones; lo vigilamos en estados electrónicos">{estados ? "privado · en estados" : "privado"}</span>}
            {registros > 1 && <span className="badge reciente">{registros} fuentes</span>}
            <div className="spacer" />
            <span className="muted small">Últ. actuación: {fmt(c.lastActuacionDate)}</span>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {c.despacho ?? "Despacho no disponible"}
            {c.departamento ? ` · ${c.departamento}` : ""}
          </div>
          {(() => {
            // Las fallas de la Rama no se muestran (se reintentan solas).
            const a = avisoProceso(c.lastError, !!estados);
            return a ? <div className="muted small" style={{ marginTop: 4 }}>{a.texto}</div> : null;
          })()}
        </Link>
      ))}

      <Paginador pagina={pag.pagina} paginas={pag.paginas} hrefDe={hrefPagina} />

      {/* No están en la Consulta Nacional: se siguen solo por los estados del juzgado (al final de la lista). */}
      {filtro === "todos" && pag.pagina === pag.paginas && estados && estados.solo.length > 0 && (
        <>
          <h2 style={{ margin: "18px 0 4px" }}>En estados electrónicos ({estados.solo.length})</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Cada noche buscamos tus radicados en el último estado que publica su juzgado. Aquí están los que la
            Consulta Nacional no tiene y los que salieron en un estado (a veces el juzgado no lo registra en la Rama).
          </p>
          {estados.solo.slice(pagE.desde, pagE.desde + POR_PAGINA).map((s) => (
            <div key={s.radicado} className="case">
            <Link
              href={s.caseId ? `/dashboard/procesos/${s.caseId}` : "/dashboard/estados"}
              style={{ display: "block", color: "inherit", textDecoration: "none" }}
            >
              <div className="row wrap">
                <span className="radicado">{s.radicado}</span>
                <span className="badge">{s.caseId ? "también en la Rama" : "solo en estados"}</span>
                <div className="spacer" />
                <span className="muted small">
                  {s.ultimo ? `Últ. estado: ${fmtUTC(s.ultimo.fecha)}` : "Sin estados encontrados aún"}
                </span>
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>
                {s.juzgado ?? `Juzgado ${s.despacho}`} · {s.radicado.slice(12, 16)}-{s.radicado.slice(16, 21)}
              </div>
              {s.ultimo ? (
                <div className="small" style={{ marginTop: 4 }}>
                  <b>{s.ultimo.titulo}</b>
                  {s.ultimo.extracto && <div className="muted">…{s.ultimo.extracto.slice(0, 220)}…</div>}
                </div>
              ) : (
                <div className="muted small" style={{ marginTop: 4 }}>
                  {s.revisadoAt
                    ? "No salió en el último estado del juzgado."
                    : "Lo revisamos esta noche (de 6 p. m. a 6:45 a. m.)."}
                </div>
              )}
            </Link>
            <div style={{ marginTop: 8 }}>
              <QuitarDeEstados radicado={s.radicado} enRama={!!s.caseId} />
            </div>
            </div>
          ))}
          <Paginador
            pagina={pagE.pagina}
            paginas={pagE.paginas}
            hrefDe={(p) => {
              const s = new URLSearchParams();
              if (pag.pagina > 1) s.set("pagina", String(pag.pagina));
              if (p > 1) s.set("pe", String(p));
              const t = s.toString();
              return `/dashboard/procesos${t ? `?${t}` : ""}`;
            }}
          />
        </>
      )}
    </div>
  );
}

// Las fechas de los estados se guardan como día (sin hora).
function fmtUTC(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
