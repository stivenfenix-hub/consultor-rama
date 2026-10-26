import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  // Enlaces de correos enviados antes del cambio: verifican e inician sesión igual.
  if (token) redirect(`/verify/confirm?token=${encodeURIComponent(token)}`);

  return (
    <div className="container">
      <div className="center">
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 12, justifyContent: "center", display: "flex" }}>
            <BrandLogo />
          </div>
          <h1>Enlace inválido</h1>
          <p className="muted">
            El enlace de verificación no es válido, ya se usó o venció.
          </p>
          <p className="muted small" style={{ marginTop: 10 }}>
            Si ya verificaste tu correo, inicia sesión. Si no, inicia sesión para que te
            reenviemos uno nuevo, o <Link href="/register">crea tu cuenta</Link>.
          </p>
          <Link href="/login" className="btn secondary" style={{ marginTop: 10 }}>
            Ir a iniciar sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
