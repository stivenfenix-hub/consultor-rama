import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PRECIOS_FIRMA, documentoDe, firmantesDe } from "@/lib/firmas";
import { PROCESOS_PARA_GRATIS, cotizar } from "@/lib/firma-cobro";
import { PLANTILLAS } from "@/services/signature-engine";
import { Asistente } from "./asistente";

export const metadata = { title: "Nuevo documento para firmar" };

/** Asistente de 4 pasos. Con ?id= retoma un borrador desde el paso 2. */
export default async function NuevoDocumento({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await searchParams;

  const doc = id ? await documentoDe(user.id, id) : null;
  if (id && (!doc || doc.estado !== "DRAFT")) redirect(doc ? `/dashboard/firmas/${doc.id}` : "/dashboard/firmas");
  const firmantes = doc ? await firmantesDe(doc.id) : [];
  const cobro = await cotizar(user.id, "otp");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link prefetch={false} href="/dashboard/firmas" className="small muted">← Firma electrónica</Link>
          <h1 style={{ marginTop: 4 }}>{doc ? doc.titulo : "Nuevo documento para firmar"}</h1>
        </div>
      </div>
      <Asistente
        plantillas={PLANTILLAS.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          descripcion: p.descripcion,
          norma: p.norma,
          campos: p.campos,
        }))}
        cobro={{
          gratis: cobro.gratis,
          motivo: cobro.motivo,
          precios: PRECIOS_FIRMA,
          procesosParaRegalo: cobro.procesosParaRegalo,
          meta: PROCESOS_PARA_GRATIS,
        }}
        borrador={doc ? { id: doc.id, titulo: doc.titulo, paginas: doc.paginas } : null}
        firmantesIniciales={firmantes.map((f) => ({
          nombre: f.nombre,
          tipoDoc: f.tipoDoc,
          numDoc: f.numDoc,
          email: f.email ?? "",
          telefono: f.telefono ?? "",
          posicion: f.posicion,
        }))}
      />
    </div>
  );
}
