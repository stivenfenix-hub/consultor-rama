import { redirect } from "next/navigation";
import { getCurrentUser, homePath } from "@/lib/auth";
import { getSiteSettings } from "@/lib/settings";
import { LOGOS } from "@/lib/marca";
import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "./login-form";
import { GoogleButton } from "@/components/google-button";

const ERROR_GOOGLE: Record<string, string> = {
  error: "No pudimos ingresar con Google. Intenta de nuevo o usa tu correo y contraseña.",
  cancelado: "Se canceló el ingreso con Google.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const { google } = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(homePath(user.role));
  const s = await getSiteSettings();

  return (
    <div className="container">
      <div className="center">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "center" }}>
            <BrandLogo size="lg" />
          </div>
          <p
            className="muted small"
            style={{ marginTop: 10, textAlign: "center" }}
          >
            Ingresa a tu cuenta para seguir tus procesos judiciales.
          </p>
          {google && ERROR_GOOGLE[google] && (
            <div className="error" style={{ marginTop: 12 }}>{ERROR_GOOGLE[google]}</div>
          )}
          <GoogleButton separador="o ingresa con tu correo" />
          <LoginForm />
          <div className="login-by">
            <span>By</span>
            <a href={s.byUrl} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGOS.by} alt="By" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
