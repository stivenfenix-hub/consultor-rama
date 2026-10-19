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
          <p className="muted small">Ingresa a tu cuenta para seguir tus procesos judiciales.</p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
