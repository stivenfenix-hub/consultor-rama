import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { documentoDe } from "@/lib/firmas";
import { Icon } from "@/components/icon";
import { PdfPaginas } from "@/components/pdf-paginas";

export const metadata = { title: "Ver documento" };

/**
 * Ver el PDF dentro de Estradox (sellado u original), con zoom: funciona igual
 * en computador y en celular, sin tener que descargarlo.
 */
export default async function VerPdf({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tipo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const doc = await documentoDe(user.id, id);
  if (!doc) notFound();
  const sellado = (await searchParams).tipo !== "original" && !!doc.firmadoUrl;
  const src = `/api/firmas/${doc.id}/pdf?inline=1${sellado ? "&tipo=firmado" : ""}`;

  return (
    <div className="page">
      <div className="page-head wrap">
        <div>
          <Link prefetch={false} href={`/dashboard/firmas/${doc.id}`} className="small muted">← Volver al documento</Link>
          <h1 style={{ marginTop: 4 }}>{doc.titulo}</h1>
          <span className={`badge ${sellado ? "new" : ""}`}>{sellado ? "PDF sellado con certificado" : "Documento original"}</span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn" href={`/api/firmas/${doc.id}/pdf${sellado ? "?tipo=firmado" : ""}`}>
            <Icon name="download" size={16} /> Descargar
          </a>
        </div>
      </div>
      <div className="firmar-doc">
        <PdfPaginas ampliable src={src} />
      </div>
    </div>
  );
}
