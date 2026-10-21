import { redirect } from "next/navigation";
import { getCurrentUser, homePath } from "@/lib/auth";
import { getSiteSettings } from "@/lib/settings";
import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
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
          <LoginForm />
          <div className="login-by">
            <span>By</span>
            <a href={s.byUrl} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.byLogoDataUrl ?? "/unor-logo.png"} alt="By" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
