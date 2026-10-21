"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction } from "@/app/actions";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, {});

  if (state.ok) {
    return (
      <div style={{ marginTop: 16 }}>
        <div className="ok">{state.ok}</div>
        <p className="muted small" style={{ marginTop: 12 }}>
          ¿Ya verificaste? <Link href="/login">Inicia sesión</Link>.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} style={{ marginTop: 16 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="small muted" htmlFor="firstName">Nombre</label>
          <input id="firstName" name="firstName" type="text" required placeholder="Ana" />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="small muted" htmlFor="lastName">Apellido</label>
          <input id="lastName" name="lastName" type="text" required placeholder="Pérez" />
        </div>
      </div>
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="email">Correo</label>
      <input id="email" name="email" type="email" required placeholder="abogado@ejemplo.com" />
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="whatsapp">WhatsApp</label>
      <input
        id="whatsapp"
        name="whatsapp"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        placeholder="300 123 4567"
      />
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="password">Contraseña</label>
      <input id="password" name="password" type="password" required autoComplete="new-password" placeholder="Mínimo 8, con letras y números" />
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="password2">Repetir contraseña</label>
      <input id="password2" name="password2" type="password" required autoComplete="new-password" placeholder="Escríbela de nuevo" />

      {/* Honeypot anti-bot: oculto para humanos */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
        aria-hidden="true"
      />

      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
        {pending ? "Creando cuenta..." : "Crear cuenta"}
      </button>
      {state.error && <div className="error">{state.error}</div>}

      <p className="muted small" style={{ marginTop: 14 }}>
        ¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link>.
      </p>
    </form>
  );
}
