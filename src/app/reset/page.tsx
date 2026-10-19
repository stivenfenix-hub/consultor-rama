import Link from "next/link";
import { ResetForm } from "./reset-form";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="container">
      <div className="center">
        <div className="card">
          <h1>Nueva contraseña</h1>
          {!token ? (
            <>
              <p className="error">Enlace inválido o incompleto.</p>
              <p className="muted small">
                <Link href="/forgot">Solicitar un enlace nuevo</Link>
              </p>
            </>
          ) : (
            <>
              <p className="muted small">Elige una contraseña nueva para tu cuenta.</p>
              <ResetForm token={token} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
