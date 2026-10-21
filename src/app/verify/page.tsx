import Link from "next/link";
import { verifyEmailToken } from "@/lib/accounts";
import { BrandLogo } from "@/components/brand-logo";
import { Icon } from "@/components/icon";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const ok = token ? await verifyEmailToken(token) : false;

  return (
    <div className="container">
      <div className="center">
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 12, justifyContent: "center", display: "flex" }}>
            <BrandLogo />
          </div>
          {ok ? (
            <>
              <h1><Icon name="checkCircle" size={26} /> Correo verificado</h1>
              <p className="muted">Tu cuenta quedó activada. Ya puedes iniciar sesión.</p>
              <Link href="/login" className="btn" style={{ marginTop: 10 }}>
                Iniciar sesión
              </Link>
            </>
          ) : (
            <>
              <h1>Enlace inválido</h1>
              <p className="muted">
                El enlace de verificación no es válido o ya venció.
              </p>
              <p className="muted small" style={{ marginTop: 10 }}>
                Inicia sesión para que te reenviemos uno nuevo, o{" "}
                <Link href="/register">crea tu cuenta</Link>.
              </p>
              <Link href="/login" className="btn secondary" style={{ marginTop: 10 }}>
                Ir a iniciar sesión
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
