import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  boldConfigurado,
  getPlan,
  getSuscripcion,
  pagosDeUsuario,
  usoProcesos,
  verificarPagosPendientes,
} from "@/lib/subscription";
import { PricingCards } from "./pay-button";

const TZ = "America/Bogota";
const fecha = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: TZ })
    : "—";
const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;

const ESTADO_PAGO: Record<string, string> = {
  PAID: "Aprobado",
  ACTIVE: "Pendiente",
  PROCESSING: "En proceso",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
  EXPIRED: "Expirado",
};

export default async function SuscripcionPage({
  searchParams,
}: {
  searchParams: Promise<{ pago?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { pago } = await searchParams;

  // Al volver del checkout (o si el webhook se demoró), confirma pagos pendientes.
  await verificarPagosPendientes(user.id);
  const [sub, plan, pagos, uso] = await Promise.all([
    getSuscripcion(user.id),
    getPlan(),
    pagosDeUsuario(user.id),
    usoProcesos(user.id),
  ]);
  const ultimoAprobado = pagos.find((p) => p.status === "PAID");
  const pagoAdicionales = ultimoAprobado?.tipo === "adicionales";
  const pagoRecienAprobado =
    !!pago && !!ultimoAprobado?.paidAt && Date.now() - new Date(ultimoAprobado.paidAt).getTime() < 30 * 60 * 1000;

  const titulo =
    sub.estado === "admin"
      ? "Cuenta administradora (sin cobro)"
      : sub.estado === "socio"
        ? "Socio de Estradox (sin cobro)"
      : sub.estado === "prueba"
        ? "Prueba gratis activa"
        : sub.estado === "activa"
          ? "Plan activo"
          : "Tu acceso venció";

  return (
    <div className="page">
      <div className="page-head">
        <h1>Suscripción</h1>
      </div>

      {pago && (
        <div className={pagoRecienAprobado ? "ok" : "muted small"} style={{ marginBottom: 12 }}>
          {pagoRecienAprobado
            ? pagoAdicionales
              ? "¡Pago aprobado! Quedaron pagados tus procesos adicionales de este mes."
              : `¡Pago aprobado! Tu acceso quedó extendido ${ultimoAprobado?.meses === 1 ? "1 mes" : `${ultimoAprobado?.meses ?? 1} meses`}.`
            : "Si ya pagaste, la confirmación de Bold puede tardar unos minutos. Recarga esta página en un momento."}
        </div>
      )}

      <div className="card" style={{ maxWidth: 560 }}>
        <h2>{titulo}</h2>
        {sub.estado !== "admin" && sub.estado !== "socio" && (
          <p style={{ marginTop: 0 }}>
            {sub.estado === "vencida" ? "Venció el " : "Tienes acceso hasta el "}
            <b>{fecha(sub.accesoHasta)}</b>
            {sub.estado !== "vencida" && <span className="muted"> ({sub.diasRestantes} día(s))</span>}
          </p>
        )}
        {uso.cobroPendiente && (
          <div className="card" style={{ marginTop: 12, borderColor: "var(--accent, #1d4ed8)" }}>
            <b>Cobro de procesos adicionales pendiente: {pesos(uso.cobroPendiente.valor)}</b>
            <p className="small" style={{ margin: "6px 0 10px" }}>
              Es el valor de este mes por los {uso.cobroPendiente.adicionales} proceso(s) que tienes por encima de lo
              que pagaste con tu plan.
            </p>
            <a className="btn" href={uso.cobroPendiente.url}>
              Pagar {pesos(uso.cobroPendiente.valor)}
            </a>
          </div>
        )}
        {uso.limitado && uso.prepago && (
          <div className="small" style={{ marginTop: 8 }}>
            <b>Procesos:</b> tu plan de {uso.prepago.meses} meses cubre{" "}
            <b>{uso.incluidos + uso.prepago.cubiertos} procesos</b> ({uso.incluidos} incluidos
            {uso.prepago.cubiertos > 0 && <> + {uso.prepago.cubiertos} adicionales que pagaste</>}) hasta el{" "}
            {fecha(sub.accesoHasta)}. Hoy tienes <b>{uso.total}</b>.{" "}
            {uso.prepago.porCobrar > 0 ? (
              <>
                Tienes <b>{uso.prepago.porCobrar} de más</b>: a {pesos(uso.precioAdicional)} c/u al mes son{" "}
                <b>{pesos(uso.prepago.valorCorte)} cada mes</b>
                {uso.prepago.proximoCorte ? (
                  <>
                    , y el próximo cobro es el <b>{fecha(uso.prepago.proximoCorte)}</b>
                  </>
                ) : (
                  <>, que se suman a tu renovación</>
                )}
                . Pagar varios meses por adelantado cubre los procesos que tenías al pagar, no procesos ilimitados. Si
                eliminas los que ya no necesitas antes del corte, no se cobran.
              </>
            ) : (
              <>
                Si pasas de {uso.incluidos + uso.prepago.cubiertos}, cada proceso de más vale{" "}
                {pesos(uso.precioAdicional)} al mes y se cobra mes a mes.
              </>
            )}
          </div>
        )}
        {uso.limitado && !uso.prepago && (
          <div className="small" style={{ marginTop: 8 }}>
            <b>Procesos:</b> llevas {uso.total} de {uso.incluidos} incluidos en tu plan.{" "}
            {uso.adicionales > 0 ? (
              <>
                Tienes <b>{uso.adicionales} adicional(es)</b> a {pesos(uso.precioAdicional)} c/u al mes:{" "}
                <b>+{pesos(uso.valorMes)}/mes</b>, que se suman a{" "}
                {sub.estado === "prueba" ? "tu primer pago (en la prueba no se cobra)" : "tu próximo pago"}.
              </>
            ) : (
              <>Desde el proceso {uso.incluidos + 1}, cada uno adicional vale {pesos(uso.precioAdicional)} al mes.</>
            )}
          </div>
        )}
      </div>

      {sub.estado !== "admin" && sub.estado !== "socio" && (
        <div style={{ maxWidth: 980 }}>
          <h2 style={{ marginBottom: 4 }}>
            {sub.estado === "vencida" ? "Elige un plan para reactivar tu cuenta" : "Elige tu plan"}
          </h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Precios en pesos colombianos, IVA y comisiones incluidas. El tiempo se suma desde que
            termina tu acceso actual: si pagas antes, no pierdes días. Pagas con tarjeta, PSE,
            Nequi o Botón Bancolombia a través de Bold.
          </p>
          {boldConfigurado() ? (
            <PricingCards
              paquetes={plan.paquetes}
              accion={sub.estado === "vencida" ? "Reactivar" : "Elegir plan"}
              extraMes={uso.valorMes}
              adicionales={uso.adicionales}
            />
          ) : (
            <p className="muted small">Los pagos en línea estarán disponibles muy pronto.</p>
          )}
        </div>
      )}

      {pagos.length > 0 && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h2>Historial de pagos</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Plan</th>
                  <th>Valor</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id}>
                    <td className="muted">{fecha(p.paidAt ?? p.createdAt)}</td>
                    <td>
                      {p.tipo === "adicionales"
                        ? `${p.adicionales ?? ""} proceso(s) adicional(es)`
                        : p.meses === 1
                          ? "1 mes"
                          : `${p.meses} meses`}
                    </td>
                    <td>{pesos(p.amount)}</td>
                    <td>{ESTADO_PAGO[p.status] ?? p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
