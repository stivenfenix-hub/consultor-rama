import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PLANTILLA_SIN_PROCESOS, usuariosSinRadicados } from "@/lib/reporte-whatsapp";
import { estadoWhatsapp } from "@/lib/whatsapp";
import { EnviarSinRadicados } from "./enviar";

/** Root: todos los que siguen con 0 radicados, para escribirles por WhatsApp. */
export default async function SinRadicados() {
  const admin = await getCurrentUser();
  if (admin?.role !== "admin") redirect("/dashboard");
  const [usuarios, wa] = await Promise.all([usuariosSinRadicados(), estadoWhatsapp().catch(() => [])]);
  const comercial = wa.find((e) => e.cuenta === "comercial");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link prefetch={false} href="/dashboard/admin/usuarios" className="small muted">← Usuarios</Link>
          <h1 style={{ marginTop: 4 }}>Usuarios con 0 radicados ({usuarios.length})</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Se registraron y todavía no tienen ningún proceso. Elige a quiénes escribirles, ajusta el mensaje y envíalo
            por el WhatsApp comercial.
          </p>
        </div>
      </div>
      {!comercial?.numero && (
        <div className="card">
          <div className="error small">
            El WhatsApp comercial no está vinculado, así que no se puede enviar.{" "}
            <Link prefetch={false} href="/dashboard/admin/whatsapp">Vincularlo</Link>
          </div>
        </div>
      )}
      <EnviarSinRadicados
        plantilla={PLANTILLA_SIN_PROCESOS}
        maxDia={comercial?.maxDia ?? 40}
        usuarios={usuarios.map((u) => ({
          id: u.id,
          nombre: u.nombre,
          email: u.email,
          telefono: u.telefono,
          registro: new Date(u.createdAt).toISOString(),
          intentoCarga: u.intentoCarga,
          ultimoWa: u.ultimoWa ? new Date(u.ultimoWa).toISOString() : null,
        }))}
      />
    </div>
  );
}
