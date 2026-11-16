import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { documentoDe, firmantesDe } from "@/lib/firmas";
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
