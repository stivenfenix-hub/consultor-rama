import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="container">
      <div className="center">
        <div className="card">
          <h1>Consultor de Procesos</h1>
          <p className="muted small">
            Ingresa con tu correo para seguir tus procesos judiciales.
          </p>
          <LoginForm />
          <p className="muted small" style={{ marginTop: 16 }}>
            Demo: el ingreso es solo por correo (sin contrasena). Reemplazar por
            OTP/magic-link antes de produccion.
          </p>
        </div>
      </div>
    </div>
  );
}
