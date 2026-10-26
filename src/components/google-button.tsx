import Link from "next/link";
import { googleConfigurado } from "@/lib/google-auth";

/**
 * "Continuar con Google" (login y registro). No se muestra mientras no estén
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el servidor.
 */
export function GoogleButton({ separador }: { separador: string }) {
  if (!googleConfigurado()) return null;
  return (
    <div style={{ marginTop: 16 }}>
      {/* Enlace normal (no fetch): el navegador debe ir a Google. */}
      <a href="/api/auth/google/start" className="btn inbox-btn" style={{ width: "100%", justifyContent: "center" }}>
        <span className="inbox-logo">
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
            <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
          </svg>
        </span>
        Continuar con Google
      </a>
      <p className="muted small" style={{ margin: "8px 0 0", textAlign: "center" }}>
        Al continuar con Google aceptas los{" "}
        <Link href="/terminos" target="_blank">Términos</Link> y la{" "}
        <Link href="/privacidad" target="_blank">Política de Datos</Link>.
      </p>
      <div className="or-divider">
        <span>{separador}</span>
      </div>
    </div>
  );
}
