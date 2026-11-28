import Link from "next/link";
import { listUsers, resumenUsuarios } from "@/lib/admin";
import { getWhatsappPorUsuario } from "@/lib/accounts";
import { StatTile } from "@/components/charts";
import { EliminarUsuario } from "./eliminar-usuario";
import { DesactivarUsuario } from "./desactivar-usuario";
import { idsDesactivados } from "@/lib/cuenta-desactivada";
import { motivosSospecha } from "@/lib/sospechoso";
import { resumenCargasPorUsuario } from "@/lib/sync";
import { conteoProcesosPorUsuario } from "@/lib/estados";
import { suscripcionesDeTodos } from "@/lib/subscription";
import { ExtendTrialButton } from "../suscripciones/gift-days-button";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Bogota",
  });
}

const POR_PAGINA = 20;

/** Botones para ver solo un tipo de usuario (28 nov 2026). */
const FILTROS = [
  { clave: "membresia", estado: "activa", texto: "💳 Membresía", clase: "new" },
  { clave: "prueba", estado: "prueba", texto: "Prueba", clase: "reciente" },
  { clave: "vencio", estado: "vencida", texto: "Venció", clase: "warn" },
] as const;

export default async function UsuariosAdmin({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string; q?: string; estado?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const filtro = FILTROS.find((f) => f.clave === sp.estado) ?? null;
  // El estado de todos se calcula una vez: sirve para los botones, sus conteos y la etiqueta.
  const subs = await suscripcionesDeTodos().catch(() => null);
  const idsDe = (estado: string) => [...(subs ?? new Map())].filter(([, s]) => s.estado === estado).map(([id]) => id);
  // La tabla va de a 20 (solo se cargan esos); totales y sospechosos miran a todos.
  const [todos, pagina] = await Promise.all([
    resumenUsuarios(),
    listUsers({
      pagina: Number(sp.pagina) || 1,
      porPagina: POR_PAGINA,
      q,
      ids: filtro && subs ? idsDe(filtro.estado) : undefined,
    }),
  ]);
  const users = pagina.users;
  const ids = users.map((u) => u.id);
  const [whatsapp, cargas, procesos, desactivados] = await Promise.all([
    getWhatsappPorUsuario(ids),
    resumenCargasPorUsuario(ids).catch(() => new Map<string, { cargas: number; conError: number; reintentos: number }>()),
    conteoProcesosPorUsuario(ids).catch(() => new Map<string, number>()),
    idsDesactivados(ids),
  ]);
  const sospechas = new Map<string, string[]>();
  for (const u of todos) {
    const m = u.role === "admin" ? [] : motivosSospecha(u);
    if (m.length > 0) sospechas.set(u.id, m);
  }
  const sospechosos = todos.filter((u) => sospechas.has(u.id));
  const enlace = (p: number) => {
    const s = new URLSearchParams();
    if (p > 1) s.set("pagina", String(p));
    if (q) s.set("q", q);
    if (filtro) s.set("estado", filtro.clave);
    const t = s.toString();
    return `/dashboard/admin/usuarios${t ? `?${t}` : ""}`;
  };
  const now = Date.now();
  const activos = todos.filter(
    (u) =>
      u.lastLoginAt &&
      now - new Date(u.lastLoginAt).getTime() < 30 * 24 * 60 * 60 * 1000,
  ).length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Usuarios</h1>
        <Link prefetch={false} className="btn secondary" href="/dashboard/admin/usuarios/sin-radicados">
          Con 0 radicados · WhatsApp
        </Link>
      </div>

      <section className="stat-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <StatTile label="Total" value={todos.length} />
        <StatTile label="Activos (30 días)" value={activos} accent="var(--green)" />
      </section>

      {sospechosos.length > 0 && (
        <div className="card">
          <h2>⚠️ Registros sospechosos por revisar</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Sus datos parecen de relleno. Ya se les avisó que la cuenta puede ser eliminada (pueden
            corregir su nombre). Nada se borra solo: revísalos y elimínalos si lo apruebas.
          </p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {sospechosos.slice(0, POR_PAGINA).map((u) => (
                  <tr key={u.id}>
                    <td>{u.name ?? "—"}</td>
                    <td className="muted">{u.email}</td>
                    <td className="muted small">{sospechas.get(u.id)!.join("; ")}</td>
                    <td className="muted">{fmt(u.createdAt)}</td>
                    <td>
                      <EliminarUsuario id={u.id} email={u.email} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sospechosos.length > POR_PAGINA && (
            <p className="muted small">
              Se muestran {POR_PAGINA} de {sospechosos.length}. Al eliminar o revisar estos aparecen los siguientes.
            </p>
          )}
        </div>
      )}

      <div className="card">
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          {[{ clave: "", texto: "Todos", clase: "", n: todos.length }, ...FILTROS.map((f) => ({ ...f, n: idsDe(f.estado).length }))].map((f) => {
            const activo = (filtro?.clave ?? "") === f.clave;
            const s = new URLSearchParams();
            if (f.clave) s.set("estado", f.clave);
            if (q) s.set("q", q);
            const t = s.toString();
            return (
              <Link
                key={f.clave || "todos"}
                prefetch={false}
                href={`/dashboard/admin/usuarios${t ? `?${t}` : ""}`}
                className={`btn small ${activo ? "" : "secondary"}`}
                aria-current={activo ? "page" : undefined}
              >
                {f.texto} <span className={`badge ${f.clase}`} style={{ marginLeft: 6 }}>{f.n}</span>
              </Link>
            );
          })}
        </div>
        <form method="get" className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          {filtro && <input type="hidden" name="estado" value={filtro.clave} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre, correo o WhatsApp"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="btn secondary" type="submit">Buscar</button>
          {q && (
            <Link prefetch={false} className="btn secondary" href={`/dashboard/admin/usuarios${filtro ? `?estado=${filtro.clave}` : ""}`}>
              Limpiar
            </Link>
          )}
          {/* Siempre descarga todos los usuarios, aunque haya una búsqueda. */}
          <a className="btn" href="/api/admin/usuarios-excel" download>
            Descargar todos (Excel)
          </a>
        </form>
        <div className="muted small" style={{ marginBottom: 8 }}>
          {pagina.total === 0
            ? "Ningún usuario coincide."
            : `Mostrando ${(pagina.pagina - 1) * POR_PAGINA + 1}–${Math.min(pagina.pagina * POR_PAGINA, pagina.total)} de ${pagina.total}${filtro ? ` · ${filtro.texto}` : ""}${q ? ` que coinciden con “${q}”` : ""}`}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>WhatsApp</th>
                <th>Rol</th>
                <th>Procesos</th>
                <th title="Veces que intentó agregar procesos (desde el 28 de oct)">Intentos de carga</th>
                <th>Último acceso</th>
                <th>Registro</th>
                <th>Acceso hasta</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link prefetch={false} href={`/dashboard/admin/usuarios/${u.id}`}>{u.name ?? "—"}</Link>
                    {(() => {
                      // Al lado del nombre: si paga membresía, está de prueba, venció o es socio.
                      const e = subs?.get(u.id)?.estado;
                      const et =
                        e === "activa" ? { c: "new", t: "💳 Membresía", d: "Tiene un plan pagado vigente" }
                        : e === "prueba" ? { c: "reciente", t: "Prueba", d: "En prueba gratis" }
                        : e === "vencida" ? { c: "warn", t: "Venció", d: "Sin acceso: venció la prueba o el plan" }
                        : e === "socio" ? { c: "", t: "Socio", d: "Socio de Estradox (sin cobro)" }
                        : null;
                      return et ? (
                        <span className={`badge ${et.c}`} title={et.d} style={{ marginLeft: 6, whiteSpace: "nowrap" }}>
                          {et.t}
                        </span>
                      ) : null;
                    })()}
                    {desactivados.has(u.id) && (
                      <div className="badge" title="No se vigila, no se le escribe y no puede entrar" style={{ marginTop: 4 }}>
                        ⏸ Desactivada
                      </div>
                    )}
                    {sospechas.has(u.id) && (
                      <div className="badge warn" title={sospechas.get(u.id)!.join("; ")} style={{ marginTop: 4 }}>
                        ⚠️ Sospechoso
                      </div>
                    )}
                  </td>
                  <td className="muted">{u.email}</td>
                  <td>
                    {whatsapp.get(u.id) ? (
                      <a
                        href={`https://wa.me/${whatsapp.get(u.id)!.replace("+", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {whatsapp.get(u.id)}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {u.role === "admin" ? (
                      <span className="badge new">admin</span>
                    ) : (
                      <span className="badge">usuario</span>
                    )}
                  </td>
                  <td>{procesos.get(u.id) ?? 0}</td>
                  <td className="small">
                    {(() => {
                      const c = cargas.get(u.id);
                      if (!c || (c.cargas === 0 && c.reintentos === 0)) return <span className="muted">—</span>;
                      return (
                        <Link prefetch={false} href={`/dashboard/admin/usuarios/${u.id}`} title="Ver qué pasó con cada carga">
                          {c.cargas}
                          {c.conError > 0 && <span className="badge warn" style={{ marginLeft: 4 }}>{c.conError} con falla</span>}
                          {c.reintentos > 0 && <span className="badge reciente" style={{ marginLeft: 4 }}>{c.reintentos} reintentando</span>}
                        </Link>
                      );
                    })()}
                  </td>
                  <td className="muted">{fmt(u.lastLoginAt)}</td>
                  <td className="muted">{fmt(u.createdAt)}</td>
                  <td className="muted small">
                    {(() => {
                      const s = subs?.get(u.id);
                      if (!s || s.estado === "admin" || s.estado === "socio") return "—";
                      const f = s.accesoHasta ? s.accesoHasta.toLocaleDateString("es-CO", { timeZone: "America/Bogota" }) : "—";
                      return `${s.estado === "activa" ? "Plan" : s.estado === "prueba" ? "Prueba" : "Venció"} · ${f}`;
                    })()}
                  </td>
                  <td>
                    {u.role !== "admin" && (
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        {!desactivados.has(u.id) && subs?.get(u.id)?.estado !== "activa" && subs?.get(u.id)?.estado !== "socio" && (
                          <ExtendTrialButton userId={u.id} nombre={u.name} />
                        )}
                        <DesactivarUsuario id={u.id} email={u.email} desactivada={desactivados.has(u.id)} />
                        <EliminarUsuario id={u.id} email={u.email} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagina.paginas > 1 && (
          <div className="row wrap" style={{ gap: 8, marginTop: 12, justifyContent: "center", alignItems: "center" }}>
            {pagina.pagina > 1 ? (
              <Link prefetch={false} className="btn secondary small" href={enlace(pagina.pagina - 1)}>← Anterior</Link>
            ) : (
              <span className="btn secondary small" aria-disabled style={{ opacity: 0.4 }}>← Anterior</span>
            )}
            <span className="muted small">
              Página {pagina.pagina} de {pagina.paginas}
            </span>
            {pagina.pagina < pagina.paginas ? (
              <Link prefetch={false} className="btn secondary small" href={enlace(pagina.pagina + 1)}>Siguiente →</Link>
            ) : (
              <span className="btn secondary small" aria-disabled style={{ opacity: 0.4 }}>Siguiente →</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
