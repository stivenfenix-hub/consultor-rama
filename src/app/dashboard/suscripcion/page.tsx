import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  boldConfigurado,
  getPlan,
  getSuscripcion,
  pagosDeUsuario,
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
  const [sub, plan, pagos] = await Promise.all([
    getSuscripcion(user.id),
    getPlan(),
    pagosDeUsuario(user.id),
  ]);
  const ultimoAprobado = pagos.find((p) => p.status === "PAID");
  const pagoRecienAprobado =
    !!pago && !!ultimoAprobado?.paidAt && Date.now() - new Date(ultimoAprobado.paidAt).getTime() < 30 * 60 * 1000;

  const titulo =
    sub.estado === "admin"
      ? "Cuenta administradora (sin cobro)"
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
            ? `¡Pago aprobado! Tu acceso quedó extendido ${ultimoAprobado?.meses === 1 ? "1 mes" : `${ultimoAprobado?.meses ?? 1} meses`}.`
            : "Si ya pagaste, la confirmación de Bold puede tardar unos minutos. Recarga esta página en un momento."}
        </div>
      )}

      <div className="card" style={{ maxWidth: 560 }}>
        <h2>{titulo}</h2>
        {sub.estado !== "admin" && (
          <p style={{ marginTop: 0 }}>
            {sub.estado === "vencida" ? "Venció el " : "Tienes acceso hasta el "}
            <b>{fecha(sub.accesoHasta)}</b>
            {sub.estado !== "vencida" && <span className="muted"> ({sub.diasRestantes} día(s))</span>}
          </p>
        )}
      </div>

      {sub.estado !== "admin" && (
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
                    <td>{p.meses === 1 ? "1 mes" : `${p.meses} meses`}</td>
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
