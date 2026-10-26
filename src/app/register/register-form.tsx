"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { registerAction } from "@/app/actions";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  // Error detectado en el navegador antes de enviar (contraseñas distintas).
  const [local, setLocal] = useState<{ error: string; field: string } | null>(null);
  const error = local ?? (state.error ? { error: state.error, field: state.field } : null);

  // Si hubo un error, borra y enfoca solo el campo equivocado; el resto se conserva.
  useEffect(() => {
    if (!error?.field) return;
    const el = formRef.current?.elements.namedItem(error.field);
    if (el instanceof HTMLInputElement) {
      el.value = "";
      el.focus();
    }
  }, [error?.field, state, local]);

  // Se envía a mano (en vez de <form action>) para que React no vacíe el formulario.
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (fd.get("password") !== fd.get("password2")) {
      setLocal({ error: "Las contraseñas no coinciden.", field: "password2" });
      return;
    }
    setLocal(null);
    startTransition(() => formAction(fd));
  }
  // Marca en rojo el campo con error.
  const cls = (name: string) => (error?.field === name ? "input-error" : undefined);

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
    <form ref={formRef} onSubmit={onSubmit} style={{ marginTop: 16 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="small muted" htmlFor="firstName">Nombre</label>
          <input id="firstName" className={cls("firstName")} name="firstName" type="text" required placeholder="Ana" />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="small muted" htmlFor="lastName">Apellido</label>
          <input id="lastName" className={cls("lastName")} name="lastName" type="text" required placeholder="Pérez" />
        </div>
      </div>
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="email">Correo</label>
      <input id="email" className={cls("email")} name="email" type="email" required placeholder="abogado@ejemplo.com" />
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="whatsapp">WhatsApp</label>
      <input
        id="whatsapp"
        className={cls("whatsapp")}
        name="whatsapp"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        placeholder="300 123 4567"
      />
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="password">Contraseña</label>
      <input id="password" className={cls("password")} name="password" type="password" required autoComplete="new-password" placeholder="Mínimo 8, con letras y números" />
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="password2">Repetir contraseña</label>
      <input id="password2" className={cls("password2")} name="password2" type="password" required autoComplete="new-password" placeholder="Escríbela de nuevo" />

      {/* Honeypot anti-bot: oculto para humanos */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
        aria-hidden="true"
      />

      <p className="muted small" style={{ margin: "14px 0 0" }}>
        Al crear tu cuenta aceptas los{" "}
        <Link href="/terminos" target="_blank">Términos y Condiciones</Link> y autorizas el
        tratamiento de tus datos, incluido el envío de ofertas y novedades, según la{" "}
        <Link href="/privacidad" target="_blank">Política de Tratamiento de Datos</Link>.
      </p>

      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
        {pending ? "Creando cuenta..." : "Crear cuenta"}
      </button>
      {error && <div className="error">{error.error}</div>}

      <p className="muted small" style={{ marginTop: 14 }}>
        ¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link>.
      </p>
    </form>
  );
}
