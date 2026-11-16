import { headers } from "next/headers";
import { BrandLogo } from "@/components/brand-logo";
import { auditar, marcarVisto, nombreAbogado, origenDe } from "@/lib/firmas";
import { accesoFirmante, bloqueo } from "@/lib/firma-portal";
import { telefonoWa } from "@/lib/firma-envios";
import { ACEPTACION } from "@/lib/firma-textos";
import { PortalFirma } from "./portal";

export const metadata = { title: "Firmar documento · Estradox", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Portal del firmante: entra con el enlace personal que le llegó (sin cuenta). */
export default async function Firmar({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await accesoFirmante(token);

  return (
    <div className="firmar-pagina">
      <header className="firmar-cabecera">
        <BrandLogo />
        <span className="muted small">Firma electrónica</span>
      </header>
      <main className="firmar-cuerpo">
        {!a.ok ? (
          <div className="card" style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 22 }}>Enlace no válido</h1>
            <p className="muted">
              Este enlace no existe o ya no está disponible. Pídale a su abogado que le envíe el documento de nuevo.
            </p>
          </div>
        ) : (
          await (async () => {
            const { firmante: f, doc } = a;
            const origen = origenDe(await headers());
            await auditar(doc.id, "LINK_OPENED", { firmanteId: f.id, ...origen });
            await marcarVisto(f.id);
            const tel = telefonoWa(f.telefono);
            const [u, d] = (f.email ?? "").split("@");
            return (
              <PortalFirma
                token={token}
                abogado={await nombreAbogado(doc.userId)}
                titulo={doc.titulo}
                nombre={f.nombre}
                documento={`${f.tipoDoc} ${f.numDoc}`}
                canales={{
                  correo: doc.otpCorreo && f.email ? `${u.slice(0, 2)}***@${d}` : null,
                  whatsapp: doc.otpWhatsapp && tel ? `terminado en ${tel.slice(-4)}` : null,
                }}
                verificado={a.verificado}
                bloqueo={bloqueo(doc, f)}
                yaFirmo={f.estado === "SIGNED"}
                completado={doc.estado === "COMPLETED"}
                verificacion={doc.verificacion}
                identidadHecha={!!f.identidadAt}
                numDoc={f.numDoc}
                posicion={f.posicion}
                aceptacion={ACEPTACION}
              />
            );
          })()
        )}
      </main>
      <footer className="firmar-pie muted small">
        Firma electrónica con validez legal en Colombia · Ley 527 de 1999 · Decreto 2364 de 2012 · Ley 2213 de 2022
      </footer>
    </div>
  );
}
