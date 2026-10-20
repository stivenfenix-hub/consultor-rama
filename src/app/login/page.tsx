import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="container">
      <div className="center">
        <div className="card">
          <Brand size="lg" />
          <p className="muted small" style={{ marginTop: 10 }}>
            Ingresa a tu cuenta para seguir tus procesos judiciales.
          </p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
