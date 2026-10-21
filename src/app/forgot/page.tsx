import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { Icon } from "@/components/icon";
import { ForgotForm } from "./forgot-form";

export default function ForgotPage() {
  return (
    <div className="container">
      <div className="center">
        <div className="card">
          <div style={{ marginBottom: 12 }}><BrandLogo /></div>
          <h1>Recuperar contraseña</h1>
          <p className="muted small">
            Te enviaremos un enlace para restablecerla.
          </p>
          <ForgotForm />
          <p className="muted small" style={{ marginTop: 14 }}>
            <Link href="/login"><Icon name="arrowLeft" size={14} /> Volver a iniciar sesión</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
