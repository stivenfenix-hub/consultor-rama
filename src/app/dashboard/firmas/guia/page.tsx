import Link from "next/link";
import { GuiaFirma } from "./guia";

export const metadata = { title: "Guía de firma electrónica" };

/** Guía: qué documentos sirven con firma electrónica en Colombia y cuáles necesitan notaría. */
export default function GuiaFirmaPage() {
  return (
    <div className="page">
      <Link prefetch={false} href="/dashboard/firmas" className="small muted">← Firma electrónica</Link>
      <div style={{ height: 10 }} />
      <GuiaFirma />
    </div>
  );
}
