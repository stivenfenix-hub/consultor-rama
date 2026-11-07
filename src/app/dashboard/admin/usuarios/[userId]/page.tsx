import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { detalleCargasUsuario } from "@/lib/sync";
import { sinLimiteManual } from "@/lib/limits";
import { esSocio } from "@/lib/subscription";
import { Interruptor } from "./sin-limite";
import { RevisarEstadosAhora } from "./revisar-estados";
import { estadosActivo, hallazgosDelUsuario, totalHallazgos, vigiladosDelUsuario } from "@/lib/estados";
import { Paginador, POR_PAGINA, paginaDe } from "@/components/paginador";

const hora = (d: Date | null) =>
  d ? new Date(d).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : "—";

/** Cada lista va de a 20 con su propia página en la URL. */
type Params = { ph?: string; pd?: string; pp?: string; pr?: string; pc?: string };

/** Root: qué pasó con cada carga de procesos de un usuario (para dar soporte). */
export default async function CargasUsuario({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Params>;
}) {
  const admin = await getCurrentUser();
  if (admin?.role !== "admin") redirect("/dashboard");
  const { userId } = await params;
  const sp = await searchParams;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true, lastName: true, role: true },
  });
  if (!user) notFound();

  const desdeDe = (v: string | undefined) => (Math.max(1, Number(v) || 1) - 1) * POR_PAGINA;
  const [detalle, libre, estados, socio] = await Promise.all([
    detalleCargasUsuario(userId, { cargas: desdeDe(sp.pc), reintentos: desdeDe(sp.pr), procesos: desdeDe(sp.pp) }),
    sinLimiteManual({ id: userId, role: user.role }),
    estadosActivo(userId),
    esSocio(userId),
  ]);
  const { cargas, reintentos, procesos, totales } = detalle;
  const pagC = paginaDe(sp.pc, totales.cargas);
  const pagR = paginaDe(sp.pr, totales.reintentos);
  const pagP = paginaDe(sp.pp, totales.procesos);

  const totalH = estados ? await totalHallazgos(userId) : 0;
  const pagH = paginaDe(sp.ph, totalH);
  const [hallazgos, vigilados] = estados
    ? await Promise.all([hallazgosDelUsuario(userId, POR_PAGINA, pagH.desde), vigiladosDelUsuario(userId)])
    : [[], []];
  const despachos = [...new Map(vigilados.map((v) => [v.despacho, v])).values()];
  const pagD = paginaDe(sp.pd, despachos.length);

  // Enlace a otra página de una lista, sin perder la página de las demás.
  const href = (clave: keyof Params, p: number) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== clave && Number(v) > 1) s.set(k, v);
    if (p > 1) s.set(clave, String(p));
    const t = s.toString();
    return `/dashboard/admin/usuarios/${userId}${t ? `?${t}` : ""}`;
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link href="/dashboard/admin/usuarios" className="small muted">← Usuarios</Link>
          <h1 style={{ marginTop: 4 }}>
            {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}
          </h1>
          <p className="muted small" style={{ margin: 0 }}>{user.email}</p>
        </div>
      </div>

      <div className="card">
        {user.role !== "admin" && <Interruptor userId={userId} valor={socio} tipo="socio" />}
        <div style={{ height: 8 }} />
        {user.role !== "admin" && <Interruptor userId={userId} valor={libre} tipo="sinLimite" />}
        <div style={{ height: 8 }} />
        <Interruptor userId={userId} valor={estados} tipo="estados" />
      </div>

      {estados && (
        <div className="card">
          <h2>Estados electrónicos: hallazgos ({totalH})</h2>
          {hallazgos.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Radicado</th><th>Publicación</th><th>Extracto</th></tr></thead>
                <tbody>
                  {hallazgos.map((h) => (
                    <tr key={h.id}>
                      <td className="radicado">{h.radicado}</td>
                      <td className="small">
                        {h.url ? <a href={h.url} target="_blank" rel="noopener noreferrer">{h.titulo}</a> : h.titulo}
                      </td>
                      <td className="small muted">{h.extracto?.slice(0, 200)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Paginador pagina={pagH.pagina} paginas={pagH.paginas} hrefDe={(p) => href("ph", p)} />
          <h2 style={{ marginTop: 16 }}>Juzgados revisados ({despachos.length})</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Se revisan solos cada noche (6 p. m. a 6:45 a. m.). El botón corre la revisión ya, para todos los usuarios en prueba.
          </p>
          <RevisarEstadosAhora />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Despacho</th><th>Radicados</th><th>Última revisión</th><th>Publicaciones</th><th>Error</th></tr></thead>
              <tbody>
                {despachos.slice(pagD.desde, pagD.desde + POR_PAGINA).map((v) => (
                  <tr key={v.despacho}>
                    <td>
                      {v.despacho}
                      {v.juzgado && <div className="small muted">{v.juzgado}</div>}
                    </td>
                    <td>{vigilados.filter((x) => x.despacho === v.despacho).length}</td>
                    <td className="small">{hora(v.revisadoAt ?? null)}</td>
                    <td>{v.publicaciones ?? "—"}</td>
                    <td className="small">{v.ultimoError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador pagina={pagD.pagina} paginas={pagD.paginas} hrefDe={(p) => href("pd", p)} />
        </div>
      )}

      <div className="card">
        <h2>Procesos en su lista ({totales.procesos})</h2>
        {procesos.length === 0 ? (
          <p className="muted small">No tiene procesos.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Radicado</th><th>Sistema</th><th>Actuaciones</th><th>Error</th></tr></thead>
              <tbody>
                {procesos.map((p) => (
                  <tr key={p.id}>
                    <td className="radicado">{p.radicado}</td>
                    <td className="muted">{p.ubicacion?.replace(/^Software:\s*/i, "") ?? "—"}</td>
                    <td>{p.actuaciones}</td>
                    <td className="small">{p.lastError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginador pagina={pagP.pagina} paginas={pagP.paginas} hrefDe={(p) => href("pp", p)} />
      </div>

      <div className="card">
        <h2>Reintentos automáticos ({totales.reintentos})</h2>
        {reintentos.length === 0 ? (
          <p className="muted small">Ninguno pendiente.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Radicado</th><th>Intentos</th><th>Próximo</th><th>Último error</th></tr></thead>
              <tbody>
                {reintentos.map((r) => (
                  <tr key={r.radicado}>
                    <td className="radicado">{r.radicado}</td>
                    <td>{r.intentos}</td>
                    <td className="muted">{hora(r.proximoAt)}</td>
                    <td className="small">{r.ultimoError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginador pagina={pagR.pagina} paginas={pagR.paginas} hrefDe={(p) => href("pr", p)} />
      </div>

      <div className="card">
        <h2>Cargas ({totales.cargas})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Radicados</th><th>Resultado</th><th>Detalle técnico</th></tr></thead>
            <tbody>
              {cargas.map((c) => (
                <tr key={c.id}>
                  <td className="muted">{hora(c.createdAt)}</td>
                  <td className="small" style={{ wordBreak: "break-all" }}>
                    {c.radicados ?? `${c.total} (no se guardaba cuáles)`}
                  </td>
                  <td className="small">
                    {c.ok && <div>{c.ok}</div>}
                    {c.error && <div className="error">{c.error}</div>}
                    {!c.ok && !c.error && <span className="muted">{c.estado}</span>}
                  </td>
                  <td className="small muted" style={{ whiteSpace: "pre-wrap" }}>{c.detalle ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginador pagina={pagC.pagina} paginas={pagC.paginas} hrefDe={(p) => href("pc", p)} />
      </div>
    </div>
  );
}
