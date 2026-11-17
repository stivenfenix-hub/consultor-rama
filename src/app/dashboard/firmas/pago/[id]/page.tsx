import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { NIVELES, documentoDe } from "@/lib/firmas";
import { pagosPendientesDeFirma } from "@/lib/firma-cobro";
import { confirmarPago, simularPagoDev } from "@/lib/subscription";
import { Icon } from "@/components/icon";
import { Recargar } from "./recargar";

export const metadata = { title: "Pago de la firma electrónica" };
export const dynamic = "force-dynamic";

const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;

/**
 * Regreso desde Bold. Confirma el pago con el API de Bold (no se confía en la
 * URL) y, si está aprobado, el documento se envía a los firmantes. Si Bold aún
 * no lo confirma, la página se revisa sola cada pocos segundos.
 */
export default async function PagoFirma({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ simular?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { simular } = await searchParams;
  let doc = await documentoDe(user.id, id);
  if (!doc) notFound();
  if (doc.estado !== "DRAFT") redirect(`/dashboard/firmas/${doc.id}?enviado=1`);
  if (!doc.pagoId) redirect(`/dashboard/firmas/nuevo?id=${doc.id}`);

  const pagos = await pagosPendientesDeFirma(doc.id);
  for (const p of pagos) {
    if (p.status === "PAID") continue;
    if (simular && p.id.startsWith("DEV_")) await simularPagoDev(p.id);
    else if (!p.id.startsWith("DEV_")) await confirmarPago(p.id).catch((e) => console.error("[firma] confirmar pago", e));
  }
  doc = (await documentoDe(user.id, id)) ?? doc;
  if (doc.estado !== "DRAFT") redirect(`/dashboard/firmas/${doc.id}?enviado=1`);

  const vigente = pagos.find((p) => p.id === doc.pagoId);
  const rechazado = vigente && (vigente.status === "REJECTED" || vigente.status === "CANCELLED" || vigente.status === "EXPIRED");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link prefetch={false} href="/dashboard/firmas" className="small muted">← Firma electrónica</Link>
          <h1 style={{ marginTop: 4 }}>{doc.titulo}</h1>
        </div>
      </div>
      <div className="card firma-pago">
        {rechazado ? (
          <>
            <div className="firma-veredicto-icon rojo"><Icon name="alert" size={22} /></div>
            <h2>El pago no se completó</h2>
            <p className="muted">
              Bold no aprobó el pago, así que todavía no enviamos el documento. Puedes intentarlo de nuevo.
            </p>
          </>
        ) : (
          <>
            <div className="firma-veredicto-icon"><Icon name="clock" size={22} /></div>
            <h2>Confirmando tu pago…</h2>
            <p className="muted">
              Apenas Bold confirme el pago, enviamos los enlaces a los firmantes. Esta página se actualiza sola; si ya
              pagaste, puede tardar unos segundos.
            </p>
            <Recargar />
          </>
        )}
        <p className="small" style={{ marginBottom: 0 }}>
          {doc.precio != null && <b>{pesos(doc.precio)}</b>} · {NIVELES[doc.verificacion].t}
        </p>
        <div className="row wrap" style={{ gap: 8, justifyContent: "center", marginTop: 14 }}>
          {vigente?.url && (
            <a className="btn" href={vigente.url}>
              <Icon name="send" size={16} /> {rechazado ? "Intentar el pago de nuevo" : "Ir a pagar"}
            </a>
          )}
          <Link prefetch={false} className="btn secondary" href={`/dashboard/firmas/nuevo?id=${doc.id}`}>
            Volver a editar
          </Link>
        </div>
      </div>
    </div>
  );
}
