import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icon";
import { AddCaseForm } from "./add-case-form";
import { MAX_RADICADOS_POR_ENVIO } from "@/lib/validation";
import { cargasPendientesDeVer, reintentosDelUsuario } from "@/lib/sync";
import { CargaAviso } from "./carga-aviso";
import { DesplegarAgregar } from "./desplegar-agregar";
import { avisoProceso } from "@/lib/aviso-rama";
import { estadosActivo, hallazgosSinVer, soloEnEstados } from "@/lib/estados";
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
  searchParams: Promise<{ filtro?: string; pagina?: string; pe?: string; agregar?: string; q?: string }>;
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
        // Para el buscador (por palabra).
        sujetos: true,
        tipoProceso: true,
        claseProceso: true,
        ponente: true,
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
  const casos = [...porRadicado.values()].map((g) => ({
    tipo: "caso" as const,
    principal: g[0],
    registros: g.length,
    nuevas: g.reduce((n, c) => n + c.unseenCount, 0),
    privado: g.every((c) => c.esPrivado),
    fecha: g[0].lastActuacionDate ? new Date(g[0].lastActuacionDate).getTime() : null,
  }));
  // Los que por ahora solo están en estados electrónicos (no en la Consulta Nacional) van en la misma lista.
  const soloEstados = (estados?.solo ?? [])
    .filter((s) => !s.caseId)
    .map((s) => ({
      tipo: "estado" as const,
      s,
      nuevas: 0,
      fecha: s.ultimo?.fecha ? new Date(s.ultimo.fecha).getTime() : null,
    }));
  // Todo junto, del más reciente al más viejo (sin fecha al final).
  const todosGrupos = [...casos, ...soloEstados].sort((a, b) => (b.fecha ?? -Infinity) - (a.fecha ?? -Infinity));
  const hayProcesos = todosGrupos.length > 0;

  // Con novedades = tiene actuaciones nuevas que el abogado no ha visto.
  const { filtro: f, pagina: pg, agregar, q: qRaw } = await searchParams;
  const q = String(qRaw ?? "").trim().slice(0, 100);
  // Buscador: por radicado (o parte de él) o por palabras (partes, despacho, juzgado,
  // tipo de proceso y lo que salió en sus estados electrónicos). Incluye los que
  // solo están en estados.
  const grupos = q ? await buscarGrupos(user.id, todosGrupos, q) : todosGrupos;
  const filtro: Filtro = f === "novedades" || f === "aldia" ? f : "todos";
  const conNovedades = grupos.filter((g) => g.nuevas > 0);
  const alDia = grupos.filter((g) => g.nuevas === 0);
  const filtrados = filtro === "novedades" ? conNovedades : filtro === "aldia" ? alDia : grupos;
  const pag = paginaDe(pg, filtrados.length);
  const lista = filtrados.slice(pag.desde, pag.desde + POR_PAGINA);
  // Último estado electrónico de cada radicado (incluye los que también están en la Rama).
  const estadoPorRadicado = new Map(
    (estados?.solo ?? []).filter((s) => s.ultimo).map((s) => [s.radicado, s.ultimo!] as const),
  );
  // Última actuación de cada tarjeta de esta página (para ver en qué va sin abrirlo).
  const ultimas = new Map(
    (lista.length
      ? await prisma
          .$queryRawUnsafe<{ caseId: string; actuacion: string | null; anotacion: string | null }[]>(
            `SELECT DISTINCT ON ("caseId") "caseId", actuacion, anotacion FROM "Actuacion"
             WHERE "caseId" = ANY($1::text[])
             ORDER BY "caseId", "fechaActuacion" DESC NULLS LAST, "consActuacion" DESC NULLS LAST`,
            lista.flatMap((g) => (g.tipo === "caso" ? [g.principal.id] : [])),
          )
          .catch(() => [])
      : []
    ).map((a) => [a.caseId, a]),
  );
  const hrefPagina = (p: number) => {
    const s = new URLSearchParams();
    if (filtro !== "todos") s.set("filtro", filtro);
    if (q) s.set("q", q);
    if (p > 1) s.set("pagina", String(p));
    const t = s.toString();
    return `/dashboard/procesos${t ? `?${t}` : ""}`;
  };
  const pestanas: { key: Filtro; label: string; n: number }[] = [
    { key: "todos", label: "Todos", n: grupos.length },
    { key: "novedades", label: "Con novedades", n: conNovedades.length },
    { key: "aldia", label: "Al día", n: alDia.length },
  ];

  const formulario = (
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
        {uso?.limitado && uso.prepago && uso.prepago.porCobrar > 0 && (
          <div className="muted small" style={{ marginTop: 10 }}>
            📋 Tu plan de {uso.prepago.meses} meses cubre <b>{uso.incluidos + uso.prepago.cubiertos} procesos</b> ·
            llevas <b>{uso.total}</b>. Tienes <b>{uso.prepago.porCobrar} de más</b>: +{pesos(uso.prepago.valorCorte)}{" "}
            que se cobran cada mes
            {uso.prepago.proximoCorte
              ? ` (próximo cobro: ${new Date(uso.prepago.proximoCorte).toLocaleDateString("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" })})`
              : " con tu renovación"}
            . <Link prefetch={false} href="/dashboard/suscripcion">Ver detalle</Link>
          </div>
        )}
        {uso?.limitado && !uso.prepago && uso.adicionales > 0 && (
          <div className="muted small" style={{ marginTop: 10 }}>
            📋 Tu plan incluye <b>{uso.incluidos} procesos</b> · llevas <b>{uso.total}</b>. Tienes{" "}
            <b>{uso.adicionales} adicional(es)</b>: +{pesos(uso.valorMes)} al mes que se suman a tu próximo pago.{" "}
            <Link prefetch={false} href="/dashboard/suscripcion">Ver detalle</Link>
          </div>
        )}
      </div>
  );
  const tarjetaEstados = (
    <>
      {estados && (
        <Link prefetch={false} href="/dashboard/estados" className="case">
          <div className="row wrap" style={{ gap: 8 }}>
            <b>📋 Estados electrónicos (Publicaciones Procesales)</b>
            {estados.sinVer > 0 && <span className="badge new">{estados.sinVer} nuevos</span>}
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            También buscamos tus radicados en los estados que publica cada juzgado, con la tecnología de IA de
            Estradox, aunque no estén en la Consulta Nacional o sean privados.
          </div>
          <div className="small" style={{ marginTop: 10, color: "var(--accent)", fontWeight: 600 }}>
            Ver dónde salieron tus procesos →
          </div>
        </Link>
      )}
    </>
  );
  // Con estados nuevos sin ver, la tarjeta queda a la vista aunque el formulario esté oculto.
  const estadosALaVista = hayProcesos && (estados?.sinVer ?? 0) > 0;

  return (
    <div className="page">
      {/* Las caídas de la Rama no se le muestran al abogado (solo al root, en Panel admin). */}

      {/* Con procesos ya cargados, el formulario y la tarjeta de estados van tras "+ Agregar proceso" (junto al título). */}
      {!hayProcesos ? (
        <>
          <div className="page-head">
            <h1>Procesos</h1>
          </div>
          {formulario}
          {tarjetaEstados}
        </>
      ) : (
        <DesplegarAgregar titulo="Procesos" abierto={agregar === "1" || cargas.length > 0 || reintentos.length > 0}>
          {formulario}
          {!estadosALaVista && tarjetaEstados}
        </DesplegarAgregar>
      )}
      {estadosALaVista && tarjetaEstados}

      {hayProcesos && (
        <form method="get" action="/dashboard/procesos" className="procesos-buscar" role="search">
          {filtro !== "todos" && <input type="hidden" name="filtro" value={filtro} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar por radicado, parte, juzgado o palabra (también en estados electrónicos)"
            aria-label="Buscar procesos"
            maxLength={100}
          />
          <button type="submit" className="btn">Buscar</button>
          {q && (
            <Link prefetch={false} href={filtro === "todos" ? "/dashboard/procesos" : `/dashboard/procesos?filtro=${filtro}`} className="btn secondary">
              Limpiar
            </Link>
          )}
        </form>
      )}
      {q && (
        <p className="muted small" style={{ margin: "0 0 10px" }}>
          {grupos.length === 0
            ? <>No encontramos procesos para «{q}» en la Consulta Nacional ni en estados electrónicos.</>
            : <>{grupos.length} proceso(s) para «{q}».</>}
        </p>
      )}

      {hayProcesos && (
        <nav className="tabbar tabbar-3">
          {pestanas.map((p) => (
            <Link prefetch={false}
              key={p.key}
              href={`/dashboard/procesos?${new URLSearchParams({ ...(p.key !== "todos" && { filtro: p.key }), ...(q && { q }) }).toString()}`}
              className={`tab ${filtro === p.key ? "active" : ""}`}
              scroll={false}
            >
              {p.label}
              <span className="tab-count">{p.n}</span>
            </Link>
          ))}
        </nav>
      )}

      {!hayProcesos && (
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
      {hayProcesos && !q && lista.length === 0 && (
        <p className="muted">
          {filtro === "novedades"
            ? "No hay novedades sin revisar. Todos tus procesos están al día."
            : "Todos tus procesos tienen novedades por revisar."}
        </p>
      )}

      {lista.map((g) => {
        if (g.tipo === "estado") {
          // Solo en estados: no está en la Consulta Nacional; se sigue por las publicaciones del juzgado.
          const { s } = g;
          return (
            <Link prefetch={false} key={s.radicado} href={`/dashboard/estados/${s.radicado}`} className="case case-con-ultima">
              <div className="case-info">
                  <div className="row wrap">
                    <span className="radicado">{s.radicado}</span>
                    <span className="badge" title="No está en la Consulta Nacional de la Rama: lo vigilamos en Estados electrónicos (Publicaciones Procesales)">
                      solo en estados
                    </span>
                  </div>
                  <div className="muted small" style={{ marginTop: 6 }}>
                    {s.juzgado ?? `Juzgado ${s.despacho}`} · {s.radicado.slice(12, 16)}-{s.radicado.slice(16, 21)}
                  </div>
              </div>
              <div className="case-ultima" title={s.ultimo?.extracto ?? undefined}>
                {s.ultimo ? (
                  <>
                    <div className="muted small">Últ. estado electrónico · {fmtUTC(s.ultimo.fecha)}</div>
                    <div className="case-ultima-nombre">{s.ultimo.titulo}</div>
                    {s.ultimo.extracto && <div className="muted small case-ultima-nota">{s.ultimo.extracto}</div>}
                  </>
                ) : (
                  <div className="muted small">
                    {s.revisadoAt
                      ? "Aún no sale en los estados del juzgado."
                      : "Lo revisamos esta noche (de 6 p. m. a 6:45 a. m.)."}
                  </div>
                )}
              </div>
            </Link>
          );
        }
        const { principal: c, registros, nuevas, privado } = g;
        const u = ultimas.get(c.id);
        // Si salió en un estado electrónico el mismo día o después, ese es en realidad lo último.
        const est = estadoPorRadicado.get(c.radicado);
        const diaAct = c.lastActuacionDate
          ? new Date(c.lastActuacionDate).toLocaleDateString("en-CA", { timeZone: "America/Bogota" })
          : "";
        const diaEst = est?.fecha ? new Date(est.fecha).toISOString().slice(0, 10) : "";
        const usarEstado = !!est && (!diaAct || (!!diaEst && diaEst >= diaAct));
        return (
        <Link prefetch={false} key={c.id} href={`/dashboard/procesos/${c.id}`} className="case case-con-ultima">
          <div className="case-info">
            <div className="row wrap">
              <span className="radicado">{c.radicado}</span>
              {nuevas > 0 && <span className="badge new">{nuevas} nuevas</span>}
              {privado && <span className="badge" title="Privado en la Rama: lo seguimos con la tecnología de IA de Estradox en Estados electrónicos (Publicaciones Procesales)">{estados ? "✓ lo seguimos en estados" : "privado"}</span>}
              {registros > 1 && <span className="badge reciente">{registros} fuentes</span>}
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
          </div>
          {/* En qué va: la última actuación, sin tener que abrir el proceso. */}
          <div className="case-ultima" title={(usarEstado ? est?.extracto : u?.anotacion) ?? undefined}>
            {usarEstado && est ? (
              <>
                <div className="muted small">Últ. estado electrónico · {fmtUTC(est.fecha)}</div>
                <div className="case-ultima-nombre">{est.titulo}</div>
                {est.extracto && <div className="muted small case-ultima-nota">{est.extracto}</div>}
              </>
            ) : (
            <>
            <div className="muted small">Últ. actuación · {fmt(c.lastActuacionDate)}</div>
            {u?.actuacion ? (
              <>
                <div className="case-ultima-nombre">{u.actuacion}</div>
                {u.anotacion && <div className="muted small case-ultima-nota">{u.anotacion}</div>}
              </>
            ) : (
              <div className="muted small">Sin actuaciones aún</div>
            )}
            </>
            )}
          </div>
        </Link>
        );
      })}

      <Paginador pagina={pag.pagina} paginas={pag.paginas} hrefDe={hrefPagina} />

    </div>
  );
}

/** Minúsculas y sin tildes, para comparar sin importar cómo se escribió. */
function normalizar(t: string) {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Filtra las tarjetas por la búsqueda. Números (5 o más dígitos) buscan dentro del
 * radicado; las palabras deben estar todas en el texto del proceso: radicado,
 * despacho, departamento, partes, tipo/clase, ponente, juzgado y los extractos de
 * sus estados electrónicos.
 */
async function buscarGrupos<
  G extends
    | { tipo: "caso"; principal: { id: string; radicado: string; despacho: string | null; departamento: string | null; sujetos: string | null; tipoProceso: string | null; claseProceso: string | null; ponente: string | null } }
    | { tipo: "estado"; s: { radicado: string; despacho: string; juzgado: string | null; ultimo: { titulo: string; extracto: string | null } | null } },
>(userId: string, grupos: G[], q: string): Promise<G[]> {
  const digitos = q.replace(/\D/g, "");
  if (digitos.length >= 5 && digitos.length >= q.replace(/[\s-]/g, "").length) {
    return grupos.filter((g) => (g.tipo === "caso" ? g.principal.radicado : g.s.radicado).includes(digitos));
  }
  const palabras = normalizar(q).split(/\s+/).filter(Boolean);
  if (!palabras.length) return grupos;
  // Partes de cada proceso y texto de sus estados electrónicos (solo del abogado).
  const [partes, hallazgos] = await Promise.all([
    prisma
      .$queryRawUnsafe<{ caseId: string; nombres: string }[]>(
        `SELECT p."caseId", string_agg(coalesce(p.nombre, '') || ' ' || coalesce(p.identificacion, ''), ' ') AS nombres
         FROM "Parte" p JOIN "Case" c ON c.id = p."caseId" WHERE c."userId" = $1 GROUP BY p."caseId"`,
        userId,
      )
      .catch(() => []),
    prisma
      .$queryRawUnsafe<{ radicado: string; texto: string }[]>(
        `SELECT h.radicado, string_agg(left(coalesce(h.extracto, ''), 600) || ' ' || coalesce(p.titulo, ''), ' ') AS texto
         FROM "EstadoHallazgo" h LEFT JOIN "EstadoPublicacion" p ON p.id = h."publicacionId"
         WHERE h."userId" = $1 GROUP BY h.radicado`,
        userId,
      )
      .catch(() => []),
  ]);
  const partesDe = new Map(partes.map((p) => [p.caseId, p.nombres]));
  const estadosDe = new Map(hallazgos.map((h) => [h.radicado, h.texto]));
  return grupos.filter((g) => {
    const texto =
      g.tipo === "caso"
        ? [g.principal.radicado, g.principal.despacho, g.principal.departamento, g.principal.sujetos, g.principal.tipoProceso, g.principal.claseProceso, g.principal.ponente, partesDe.get(g.principal.id), estadosDe.get(g.principal.radicado)]
        : [g.s.radicado, g.s.despacho, g.s.juzgado, g.s.ultimo?.titulo, g.s.ultimo?.extracto, estadosDe.get(g.s.radicado)];
    const t = normalizar(texto.filter(Boolean).join(" "));
    return palabras.every((p) => t.includes(p));
  });
}

// Las fechas de los estados se guardan como día (sin hora).
function fmtUTC(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
