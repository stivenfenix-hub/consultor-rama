import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="container">
      <div className="center">
        <div className="card">
          <h1>Crear cuenta</h1>
          <p className="muted small">
            Regístrate para empezar a seguir tus procesos judiciales.
          </p>
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}
