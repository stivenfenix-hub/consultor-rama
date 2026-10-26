import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { LEGAL } from "@/lib/legal";

/** Marco común de las páginas legales públicas. */
export function LegalShell({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="legal">
      <div style={{ marginBottom: 18 }}>
        <Link href="/">
          <BrandLogo />
        </Link>
      </div>
      <h1>{titulo}</h1>
      <p className="muted small" style={{ marginTop: 0 }}>
        Última actualización: {LEGAL.actualizado}
      </p>
      {children}
      <p className="muted small" style={{ marginTop: 36 }}>
        <Link href="/terminos">Términos y Condiciones</Link> ·{" "}
        <Link href="/privacidad">Política de Tratamiento de Datos</Link> ·{" "}
        <Link href="/register">Crear cuenta</Link>
      </p>
    </div>
  );
}
