import Link from "next/link";
import { Brand } from "@/components/brand";
import { ForgotForm } from "./forgot-form";

export default function ForgotPage() {
  return (
    <div className="container">
      <div className="center">
        <div className="card">
          <div style={{ marginBottom: 12 }}><Brand /></div>
          <h1>Recuperar contraseña</h1>
          <p className="muted small">
            Te enviaremos un enlace para restablecerla.
          </p>
          <ForgotForm />
          <p className="muted small" style={{ marginTop: 14 }}>
            <Link href="/login">← Volver a iniciar sesión</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
