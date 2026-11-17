import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ESTADOS_DOC, listarDocumentos, type EstadoDocumento } from "@/lib/firmas";
import { Paginador, POR_PAGINA, paginaDe } from "@/components/paginador";
import { Icon } from "@/components/icon";

export const metadata = { title: "Firma electrónica" };

const fecha = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" })
    : "—";

/** Color de la etiqueta de cada estado. */
const CLASE_ESTADO: Record<EstadoDocumento, string> = {
  DRAFT: "",
  PENDING: "reciente",
  PARTIALLY_SIGNED: "warn",
  COMPLETED: "new",
  REJECTED: "rojo",
  EXPIRED: "",
};

const FILTROS: { k: string; t: string; estados: EstadoDocumento[] }[] = [
  { k: "", t: "Todos", estados: [] },
  { k: "PENDING", t: "Enviados", estados: ["PENDING"] },
  { k: "PARTIALLY_SIGNED", t: "En parte", estados: ["PARTIALLY_SIGNED"] },
  { k: "COMPLETED", t: "Completados", estados: ["COMPLETED"] },
  { k: "DRAFT", t: "Borradores", estados: ["DRAFT"] },
  { k: "REJECTED", t: "Rechazados", estados: ["REJECTED"] },
  { k: "EXPIRED", t: "Vencidos", estados: ["EXPIRED"] },
];

export default async function Firmas({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string; pagina?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const estado = sp.estado && sp.estado in ESTADOS_DOC ? sp.estado : "";
  const q = sp.q?.trim().slice(0, 80) ?? "";

  // Primero el total (para saber en qué página estamos), luego esa página.
  const previo = await listarDocumentos(user.id, { estado, q, limite: 0, desde: 0 });
  const pag = paginaDe(sp.pagina, previo.total);
  const { docs, total, porEstado } = await listarDocumentos(user.id, { estado, q, limite: POR_PAGINA, desde: pag.desde });
  const todos = Object.values(porEstado).reduce((a, b) => a + b, 0);

  const href = (o: { estado?: string; pagina?: number }) => {
    const s = new URLSearchParams();
    const e = o.estado ?? estado;
    if (e) s.set("estado", e);
    if (q) s.set("q", q);
    if (o.pagina && o.pagina > 1) s.set("pagina", String(o.pagina));
    const t = s.toString();
    return `/dashboard/firmas${t ? `?${t}` : ""}`;
  };

  return (
    <div className="page">
      <div className="page-head wrap">
        <div>
          <h1>Firma electrónica</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Envía poderes y contratos para que tus clientes los firmen desde el celular, con validez legal.
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <Link prefetch={false} href="/dashboard/firmas/guia" className="btn secondary">
            ¿Qué puedo firmar?
          </Link>
          <Link prefetch={false} href="/dashboard/firmas/nuevo" className={`btn ${todos === 0 ? "btn-pulse" : ""}`}>
            + Nuevo documento
          </Link>
        </div>
      </div>

      {todos === 0 ? (
        <div className="card firma-vacio">
          <div className="cert-hero-icon">
            <Icon name="firma" size={30} />
          </div>
          <h2>Envía tu primer documento a firmar</h2>
          <p className="muted">
            Sube un PDF o usa una plantilla (poder especial, contrato de honorarios), agrega a quienes firman y marca
            dónde va cada firma. Ellos firman desde el celular con un código de verificación y tú recibes el PDF sellado
            con su certificado de auditoría.
          </p>
          <Link prefetch={false} href="/dashboard/firmas/nuevo" className="btn">
            + Nuevo documento
          </Link>
        </div>
      ) : (
        <>
          <nav className="tabbar">
            {FILTROS.filter((f) => !f.k || porEstado[f.k] || estado === f.k).map((f) => (
              <Link
                prefetch={false}
                key={f.k}
                href={href({ estado: f.k, pagina: 1 })}
                className={`tab ${estado === f.k ? "active" : ""}`}
                scroll={false}
              >
                {f.t}
                <span className="tab-count">{f.k ? (porEstado[f.k] ?? 0) : todos}</span>
              </Link>
            ))}
          </nav>

          <div className="card">
            <form method="get" className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
              {estado && <input type="hidden" name="estado" value={estado} />}
              <input name="q" defaultValue={q} placeholder="Buscar por título, radicado o firmante" style={{ flex: 1, minWidth: 200 }} />
              <button className="btn secondary" type="submit">Buscar</button>
              {q && (
                <Link prefetch={false} className="btn secondary" href={estado ? `/dashboard/firmas?estado=${estado}` : "/dashboard/firmas"}>
                  Limpiar
                </Link>
              )}
            </form>

            {docs.length === 0 ? (
              <p className="muted small">Ningún documento coincide.</p>
            ) : (
              <div className="firma-lista">
                {docs.map((d) => {
                  const pct = d.firmantes ? Math.round((d.firmados / d.firmantes) * 100) : 0;
                  return (
                    <Link
                      prefetch={false}
                      key={d.id}
                      href={
                        d.estado === "DRAFT"
                          ? d.pagoId
                            ? `/dashboard/firmas/pago/${d.id}`
                            : `/dashboard/firmas/nuevo?id=${d.id}`
                          : `/dashboard/firmas/${d.id}`
                      }
                      className="case firma-fila"
                    >
                      <div className="firma-fila-info">
                        <div className="row wrap" style={{ gap: 8 }}>
                          <b>{d.titulo}</b>
                          {d.estado === "DRAFT" && d.pagoId ? (
                            <span className="badge warn">Pendiente de pago</span>
                          ) : (
                            <span className={`badge ${CLASE_ESTADO[d.estado]}`}>{ESTADOS_DOC[d.estado]}</span>
                          )}
                        </div>
                        <div className="muted small" style={{ marginTop: 4 }}>
                          {d.radicado ? <span className="radicado">{d.radicado}</span> : "Sin radicado"} · {fecha(d.enviadoAt ?? d.createdAt)}
                        </div>
                      </div>
                      <div className="firma-progreso">
                        {d.estado === "DRAFT" ? (
                          <span className="small" style={{ color: "var(--accent)", fontWeight: 600 }}>
                            {d.pagoId ? "Pagar y enviar →" : "Continuar →"}
                          </span>
                        ) : (
                          <>
                            <div className="small muted">
                              {d.firmados} de {d.firmantes} firma(s)
                            </div>
                            <div className="firma-barra">
                              <div style={{ width: `${pct}%` }} className={pct === 100 ? "lleno" : ""} />
                            </div>
                          </>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
            <Paginador pagina={pag.pagina} paginas={pag.paginas} hrefDe={(p) => href({ pagina: p })} />
            {total > 0 && <div className="muted small" style={{ marginTop: 6 }}>{total} documento(s)</div>}
          </div>
        </>
      )}
    </div>
  );
}
